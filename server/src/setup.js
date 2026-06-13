// One-time database setup. Two modes, auto-detected:
//
//   MANAGED (Neon / Render / Supabase / any cloud Postgres):
//     You already have a database + login from the provider. Set only
//     DATABASE_URL in server/.env — this script just applies schema.sql.
//
//   SELF-HOSTED (local / your own Postgres):
//     Also set PG_SUPERUSER_URL + APP_DB_PASSWORD — this script creates the
//     `shopops` role + database first, then applies schema.sql.
//
// Idempotent — safe to re-run.
//   cd server && node src/setup.js
import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sslRequired } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SUPER = process.env.PG_SUPERUSER_URL;
const APP_PW = process.env.APP_DB_PASSWORD;
const APP_URL = process.env.DATABASE_URL;

if (!APP_URL) {
  console.error("Missing DATABASE_URL in server/.env");
  process.exit(1);
}

const sslFor = (url) => (sslRequired(url) ? { rejectUnauthorized: false } : false);
const schemaSql = () => fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

// MANAGED mode: provider already gave us a database + login. Just apply schema.
async function runManaged() {
  console.log("• Managed Postgres detected (no PG_SUPERUSER_URL) — applying schema only.");
  const app = new pg.Client({ connectionString: APP_URL, ssl: sslFor(APP_URL) });
  await app.connect();
  await app.query(schemaSql());
  await app.end();
  console.log("✓ Schema applied");
  console.log("\nDatabase ready. Next: node src/seed.js");
}

async function run() {
  if (!SUPER) return runManaged();
  if (!APP_PW) {
    console.error("Self-hosted setup also needs APP_DB_PASSWORD in server/.env");
    process.exit(1);
  }
  const DB_NAME = new URL(APP_URL).pathname.replace(/^\//, "") || "shopops";
  const APP_USER = decodeURIComponent(new URL(APP_URL).username) || "shopops";
  // 1) connect as superuser to the default db
  const su = new pg.Client({ connectionString: SUPER });
  await su.connect();

  // create role
  const role = await su.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_USER]);
  if (role.rowCount === 0) {
    await su.query(`CREATE ROLE ${ident(APP_USER)} LOGIN PASSWORD ${literal(APP_PW)}`);
    console.log(`✓ Created role ${APP_USER}`);
  } else {
    await su.query(`ALTER ROLE ${ident(APP_USER)} WITH LOGIN PASSWORD ${literal(APP_PW)}`);
    console.log(`✓ Role ${APP_USER} exists (password synced)`);
  }

  // create database
  const db = await su.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
  if (db.rowCount === 0) {
    await su.query(`CREATE DATABASE ${ident(DB_NAME)} OWNER ${ident(APP_USER)}`);
    console.log(`✓ Created database ${DB_NAME}`);
  } else {
    console.log(`✓ Database ${DB_NAME} exists`);
  }
  await su.end();

  // 2) connect to the new db as superuser to grant + enable extension, then apply schema
  const suDb = new pg.Client({ connectionString: replaceDb(SUPER, DB_NAME) });
  await suDb.connect();
  await suDb.query(`GRANT ALL ON SCHEMA public TO ${ident(APP_USER)}`);
  await suDb.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await suDb.end();

  // 3) apply schema as the app user (so objects are owned by it)
  const app = new pg.Client({ connectionString: APP_URL, ssl: sslFor(APP_URL) });
  await app.connect();
  await app.query(schemaSql());
  await app.end();
  console.log("✓ Schema applied");
  console.log("\nDatabase ready. Next: node src/seed.js");
}

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const literal = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const replaceDb = (url, db) => {
  const u = new URL(url);
  u.pathname = "/" + db;
  return u.toString();
};

run().catch((e) => {
  console.error("Setup failed:", e.message);
  process.exit(1);
});
