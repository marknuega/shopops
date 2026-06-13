// Populate a live database with realistic demo activity so every screen looks
// alive — sales across the month (incl. today), repair jobs in every stage,
// ratings, funds, bills, a supplier + received PO, a second branch, and more
// products. Safe by design: if any sales already exist it does nothing, so it
// never doubles up or touches a shop that's already in real use.
//
//   cd server && node src/seed-demo.js          (or: npm run db:demo)
//
// Re-seed from scratch with:  FORCE=1 node src/seed-demo.js   (only wipes the
// demo activity tables, never your users/branches/products).
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { query, tx, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rand(0, arr.length - 1)];
const daysAgo = (d, h = rand(8, 19)) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, rand(0, 59), 0, 0);
  return t.toISOString();
};

const EXTRA_PRODUCTS = [
  { sku: "SCR-001", name: "Screen Protector (iPhone)", category: "Accessories", cost: 30, price: 150, qty: 45, min: 12, warranty: 0 },
  { sku: "ADP-001", name: "OTG Adapter USB-C", category: "Cables", cost: 35, price: 99, qty: 30, min: 8, warranty: 7 },
  { sku: "SPK-001", name: "Bluetooth Speaker (mini)", category: "Audio", cost: 550, price: 1200, qty: 9, min: 3, warranty: 90 },
  { sku: "MNT-001", name: "Car Phone Mount", category: "Accessories", cost: 60, price: 199, qty: 22, min: 6, warranty: 0 },
  { sku: "MEM-001", name: "MicroSD 64GB", category: "Accessories", cost: 180, price: 450, qty: 16, min: 5, warranty: 365 },
  { sku: "HDS-001", name: "Wired Headset", category: "Audio", cost: 90, price: 250, qty: 18, min: 6, warranty: 30 },
];

const DEVICES = ["iPhone 11", "Samsung A52", "Redmi Note 10", "iPhone XR", "Oppo A78", "Vivo Y17", "Realme C55", "Cherry Mobile Aqua"];
const ISSUES = ["No display", "Battery drains fast", "Charging port loose", "Cracked screen", "No power", "Speaker not working", "Water damaged", "Software stuck on logo"];
const NAMES = ["Juan dela Cruz", "Maria Santos", "Pedro Reyes", "Ana Lopez", "Mark Villanueva", "Grace Tan", "Jose Ramos", "Liza Mercado"];
const PHONES = ["0917 000 1111", "0918 222 3333", "0920 444 5555", "0915 666 7777", "0927 888 9999"];
const PAYMENTS = ["cash", "cash", "cash", "gcash", "gcash", "maya", "card"];
const RATING_NOTES = ["Mabilis ang ayos, salamat!", "Magaling si tech, ok na phone ko.", "Sulit, mura at maayos.", "Fast and friendly service.", "Ayos, pero medyo matagal.", "Solid! Balik ako dito."];

async function ensureCategory(name) {
  let c = (await query("SELECT id FROM categories WHERE name=$1", [name])).rows[0];
  if (!c) c = (await query("INSERT INTO categories (name) VALUES ($1) RETURNING id", [name])).rows[0];
  return c.id;
}

async function run() {
  const salesCount = Number((await query("SELECT COUNT(*) n FROM sales")).rows[0].n);
  if (salesCount > 0 && !process.env.FORCE) {
    console.log(`• ${salesCount} sales already exist — skipping demo seed (set FORCE=1 to re-seed the demo activity).`);
    await pool.end();
    return;
  }
  if (process.env.FORCE) {
    console.log("• FORCE set — clearing previous demo activity (sales/services/funds/bills/ratings/POs)…");
    await query("DELETE FROM sale_items");
    await query("DELETE FROM sales");
    await query("DELETE FROM service_jobs");
    await query("DELETE FROM fund_movements");
    await query("DELETE FROM bills");
    await query("DELETE FROM ratings");
    await query("DELETE FROM purchase_order_items");
    await query("DELETE FROM purchase_orders");
  }

  // ---- branches ----
  const branch1 = (await query("SELECT id FROM branches ORDER BY created_at LIMIT 1")).rows[0];
  if (!branch1) { console.error("No branch found — run `npm run db:seed` first."); process.exit(1); }
  let branch2 = (await query("SELECT id FROM branches WHERE name ILIKE '%Cavite%' OR name ILIKE '%Branch 2%' LIMIT 1")).rows[0];
  if (!branch2) {
    branch2 = (await query("INSERT INTO branches (name, city) VALUES ($1,$2) RETURNING id", ["Branch 2 — Cavite", "Cavite"])).rows[0];
    console.log("✓ Added second branch (Cavite)");
  }
  const branches = [branch1.id, branch2.id];

  // ---- users (created by db:seed) ----
  const users = (await query("SELECT id, role, branch_id FROM app_users WHERE is_active=true")).rows;
  const owner = users.find((u) => u.role === "owner");
  const tech = users.find((u) => u.role === "technician") || owner;
  const sellers = users.filter((u) => ["owner", "manager", "sales"].includes(u.role));
  const sellerFor = (branchId) => {
    const local = sellers.filter((s) => s.branch_id === branchId || s.branch_id === null);
    return (local.length ? pick(local) : owner).id;
  };

  // ---- extra products + stock in both branches ----
  for (const p of EXTRA_PRODUCTS) {
    const catId = await ensureCategory(p.category);
    let prod = (await query("SELECT id FROM products WHERE sku=$1", [p.sku])).rows[0];
    if (!prod) {
      prod = (await query(
        "INSERT INTO products (sku, name, category_id, cost_price, selling_price, warranty_days) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [p.sku, p.name, catId, p.cost, p.price, p.warranty]
      )).rows[0];
    }
    for (const b of branches) {
      await query(
        `INSERT INTO branch_inventory (branch_id, product_id, quantity, min_stock)
         VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, product_id) DO NOTHING`,
        [b, prod.id, p.qty, p.min]
      );
    }
  }
  // Make sure the original 5 products also have stock in branch 2.
  const allProducts = (await query("SELECT id, cost_price, selling_price, warranty_days FROM products WHERE is_active=true")).rows;
  for (const prod of allProducts) {
    await query(
      `INSERT INTO branch_inventory (branch_id, product_id, quantity, min_stock)
       VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, product_id) DO NOTHING`,
      [branch2.id, prod.id, rand(4, 20), 4]
    );
  }
  // Force a couple of low-stock items so the dashboard's low-stock panel shows.
  await query("UPDATE branch_inventory SET quantity=2 WHERE branch_id=$1 AND product_id=(SELECT id FROM products WHERE sku='PWB-001')", [branch1.id]);
  await query("UPDATE branch_inventory SET quantity=3 WHERE branch_id=$1 AND product_id=(SELECT id FROM products WHERE sku='EAR-001')", [branch1.id]);

  // ---- sales across the last ~25 days (incl. today) ----
  let saleN = 0, voidedId = null;
  await tx(async (c) => {
    for (let i = 0; i < 34; i++) {
      const branchId = Math.random() < 0.7 ? branch1.id : branch2.id;
      const when = i < 4 ? daysAgo(0) : daysAgo(rand(0, 24)); // a few guaranteed today
      const nItems = rand(1, 3);
      const chosen = [];
      while (chosen.length < nItems) { const p = pick(allProducts); if (!chosen.find((x) => x.id === p.id)) chosen.push(p); }
      const items = chosen.map((p) => ({ p, qty: rand(1, 3) }));
      const subtotal = items.reduce((a, it) => a + Number(it.p.selling_price) * it.qty, 0);
      const discount = Math.random() < 0.25 ? rand(20, 80) : 0;
      const total = subtotal - discount;
      const sale = (await c.query(
        `INSERT INTO sales (branch_id, subtotal, discount, total_amount, payment_method, sold_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [branchId, subtotal, discount, total, pick(PAYMENTS), sellerFor(branchId), when]
      )).rows[0];
      for (const it of items) {
        await c.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, warranty_days)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [sale.id, it.p.id, it.qty, it.p.selling_price, it.p.cost_price, it.p.warranty_days]
        );
      }
      saleN++;
      if (i === 9) voidedId = sale.id; // one void -> shows on the red-flags panel
    }
  });
  if (voidedId) {
    await query(
      "UPDATE sales SET is_voided=true, void_reason='Wrong item rung up', voided_by=$2 WHERE id=$1",
      [voidedId, owner.id]
    );
  }

  // ---- repair / service jobs in every stage ----
  const jobPlan = [
    { status: "released", paid: true }, { status: "released", paid: true }, { status: "released", paid: true },
    { status: "ready_for_pickup" }, { status: "ready_for_pickup" },
    { status: "in_progress" }, { status: "in_progress" }, { status: "in_progress" },
    { status: "received" }, { status: "received" },
  ];
  for (const j of jobPlan) {
    const branchId = Math.random() < 0.75 ? branch1.id : branch2.id;
    const fee = rand(350, 1800);
    const received = daysAgo(rand(2, 22));
    const ready = ["ready_for_pickup", "released"].includes(j.status) ? daysAgo(rand(0, 6)) : null;
    const released = j.status === "released" ? daysAgo(rand(0, 18)) : null;
    await query(
      `INSERT INTO service_jobs
        (branch_id, customer, phone, device, issue, warranty_days, fee, amount_paid, status, tech_id, received_at, ready_at, released_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [branchId, pick(NAMES), pick(PHONES), pick(DEVICES), pick(ISSUES), 30, fee, j.paid ? fee : 0, j.status, tech.id, received, ready, released]
    );
  }

  // ---- ratings ----
  for (let i = 0; i < 7; i++) {
    await query(
      "INSERT INTO ratings (branch_id, stars, customer_name, comment, created_at) VALUES ($1,$2,$3,$4,$5)",
      [pick(branches), rand(3, 5), pick(NAMES), pick(RATING_NOTES), daysAgo(rand(0, 20))]
    );
  }

  // ---- fund movements ----
  const funds = [
    ["in", "capital", 50000, "Starting capital", 28],
    ["out", "expense", 1500, "Cleaning supplies + tools", 12],
    ["out", "expense", 800, "Transport / delivery", 6],
    ["out", "bank_deposit", 20000, "Bank deposit", 4],
    ["in", "cash_sale", 8500, "Cash sales turned over", 2],
    ["out", "owner_withdrawal", 5000, "Owner withdrawal", 1],
  ];
  for (const [dir, cat, amt, note, d] of funds) {
    await query(
      "INSERT INTO fund_movements (branch_id, direction, category, amount, notes, performed_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [branch1.id, dir, cat, amt, note, owner.id, daysAgo(d)]
    );
  }

  // ---- bills ----
  const today = new Date();
  const dueIn = (d) => { const t = new Date(today); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  const bills = [
    ["Meralco (electricity)", "Utilities", 3200, dueIn(3), false, null],
    ["PLDT Fibr (internet)", "Utilities", 1699, dueIn(6), false, null],
    ["Maynilad (water)", "Utilities", 450, dueIn(10), false, null],
    ["Shop rent", "Rent", 8000, dueIn(-2), true, daysAgo(2)],
    ["Business permit", "Government", 1200, dueIn(-5), true, daysAgo(5)],
  ];
  for (const [name, cat, amt, due, paid, paidAt] of bills) {
    await query(
      "INSERT INTO bills (branch_id, name, category, amount, due_date, is_paid, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [branch1.id, name, cat, amt, due, paid, paidAt]
    );
  }

  // ---- supplier + one received purchase order ----
  let supplier = (await query("SELECT id FROM suppliers LIMIT 1")).rows[0];
  if (!supplier) {
    supplier = (await query(
      "INSERT INTO suppliers (name, contact, phone) VALUES ($1,$2,$3) RETURNING id",
      ["Manila Gadget Supply", "Mr. Lim", "02 8888 1234"]
    )).rows[0];
  }
  const poProducts = allProducts.slice(0, 2);
  const poTotal = poProducts.reduce((a, p) => a + Number(p.cost_price) * 10, 0);
  const po = (await query(
    `INSERT INTO purchase_orders (branch_id, supplier_id, status, total_cost, notes, created_by, created_at, received_at)
     VALUES ($1,$2,'received',$3,$4,$5,$6,$7) RETURNING id`,
    [branch1.id, supplier.id, poTotal, "Restock — fast movers", owner.id, daysAgo(9), daysAgo(7)]
  )).rows[0];
  for (const p of poProducts) {
    await query(
      "INSERT INTO purchase_order_items (po_id, product_id, qty_ordered, qty_received, unit_cost) VALUES ($1,$2,10,10,$3)",
      [po.id, p.id, p.cost_price]
    );
  }

  console.log(`✓ Seeded ${saleN} sales, ${jobPlan.length} repair jobs, 7 ratings, ${funds.length} fund moves, ${bills.length} bills, 1 supplier + PO`);
  console.log("✓ Demo data ready — refresh the app, every dashboard should now be populated.");
  await pool.end();
}

run().catch((e) => { console.error("Demo seed failed:", e.message); process.exit(1); });
