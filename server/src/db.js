import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Keep money as JS numbers (numeric/​decimal -> float). Safe for shop-scale values.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

// Managed Postgres (Neon, Render, Supabase, …) requires TLS; a local Postgres
// usually doesn't. Decide from the host so the same code works in both places.
export const needsSsl = sslRequired(process.env.DATABASE_URL);

export function sslRequired(url) {
  if (!url) return false;
  if (/\bsslmode=disable\b/.test(url)) return false;
  try {
    const host = new URL(url).hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

export const query = (text, params) => pool.query(text, params);

// Run a function inside a transaction, auto rollback on error.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
