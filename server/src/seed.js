// Seed a fresh ShopOps database: one branch, an owner login, default categories,
// and the demo products with starting stock. Idempotent — re-running won't duplicate.
//
//   cd server && node src/seed.js
//
// Reads SEED_* values from server/.env.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { query, pool } from "./db.js";
import { hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const OWNER_USER = process.env.SEED_OWNER_USERNAME || "owner";
const OWNER_PW = process.env.SEED_OWNER_PASSWORD || "changeme123";
const OWNER_NAME = process.env.SEED_OWNER_NAME || "Shop Owner";
const BRANCH_NAME = process.env.SEED_BRANCH_NAME || "Branch 1";

const PRODUCTS = [
  { sku: "CHG-001", name: "Fast Charger 20W (Type-C)", category: "Chargers", cost: 180, price: 350, qty: 24, min: 5 },
  { sku: "CBL-001", name: "USB-C Cable 1m", category: "Cables", cost: 45, price: 120, qty: 40, min: 10 },
  { sku: "EAR-001", name: "TWS Earbuds", category: "Audio", cost: 320, price: 650, qty: 12, min: 4 },
  { sku: "TGL-001", name: "Tempered Glass (Universal)", category: "Accessories", cost: 25, price: 99, qty: 60, min: 15 },
  { sku: "PWB-001", name: "Power Bank 10,000mAh", category: "Power", cost: 450, price: 850, qty: 8, min: 3 },
];

async function run() {
  // branch
  let branch = (await query("SELECT id FROM branches ORDER BY created_at LIMIT 1")).rows[0];
  if (!branch) {
    branch = (
      await query("INSERT INTO branches (name, city) VALUES ($1,$2) RETURNING id", [BRANCH_NAME, "Philippines"])
    ).rows[0];
    console.log(`✓ Created branch "${BRANCH_NAME}"`);
  } else {
    console.log("✓ Branch already exists");
  }

  // owner
  const existing = (await query("SELECT id FROM app_users WHERE lower(username)=lower($1)", [OWNER_USER])).rows[0];
  if (!existing) {
    const hash = await hashPassword(OWNER_PW);
    await query(
      "INSERT INTO app_users (username, password_hash, full_name, role, branch_id) VALUES ($1,$2,$3,'owner',NULL)",
      [OWNER_USER, hash, OWNER_NAME]
    );
    console.log(`✓ Created owner login "${OWNER_USER}"`);
  } else {
    console.log(`✓ Owner "${OWNER_USER}" already exists (password unchanged)`);
  }

  // One demo login per role, so every kind of user can sign in on day one.
  // Hand these out (and change the passwords) from Staff in the app. Skipped
  // entirely if SEED_DEMO_USERS=false. All are pinned to the first branch.
  if ((process.env.SEED_DEMO_USERS ?? "true") !== "false") {
    const demo = [
      { username: "manager1",    name: "Branch Manager", role: "manager" },
      { username: "sales1",      name: "Sales Staff",    role: "sales" },
      { username: "tech1",       name: "Technician",     role: "technician" },
      { username: "partner1",    name: "Business Partner", role: "partner" },
    ];
    const demoPw = process.env.SEED_DEMO_PASSWORD || "changeme123";
    for (const d of demo) {
      const has = (await query("SELECT 1 FROM app_users WHERE lower(username)=lower($1)", [d.username])).rows[0];
      if (has) { console.log(`✓ ${d.role} "${d.username}" already exists`); continue; }
      const hash = await hashPassword(demoPw);
      await query(
        "INSERT INTO app_users (username, password_hash, full_name, role, branch_id) VALUES ($1,$2,$3,$4,$5)",
        [d.username, hash, d.name, d.role, branch.id]
      );
      console.log(`✓ Created ${d.role} login "${d.username}" (password: ${demoPw})`);
    }
  }

  // products + stock
  for (const p of PRODUCTS) {
    let cat = (await query("SELECT id FROM categories WHERE name=$1", [p.category])).rows[0];
    if (!cat) cat = (await query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [p.category])).rows[0];

    let prod = (await query("SELECT id FROM products WHERE sku=$1", [p.sku])).rows[0];
    if (!prod) {
      prod = (
        await query(
          "INSERT INTO products (sku, name, category_id, cost_price, selling_price) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [p.sku, p.name, cat.id, p.cost, p.price]
        )
      ).rows[0];
    }
    await query(
      `INSERT INTO branch_inventory (branch_id, product_id, quantity, min_stock)
       VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, product_id) DO NOTHING`,
      [branch.id, prod.id, p.qty, p.min]
    );
  }
  console.log(`✓ Seeded ${PRODUCTS.length} products with stock`);
  console.log(`\nDone. Log in as "${OWNER_USER}".`);
  await pool.end();
}

run().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
