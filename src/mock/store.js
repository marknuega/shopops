/* ------------------------------------------------------------
   In-browser data store for standalone (MOCK) mode.
   Backed by localStorage. Mirrors the server's tables so the mock API
   can produce the same response shapes the real API does.
   ------------------------------------------------------------ */
const KEY = "shopops-mock-v3";

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const now = () => new Date().toISOString();
export const invKey = (branchId, productId) => `${branchId}:${productId}`;

function seed() {
  const branch1 = uid(), branch2 = uid();
  const ownerId = uid(), techId = uid(), staffId = uid();

  const catNames = ["Chargers", "Cables", "Audio", "Accessories", "Power"];
  const categories = catNames.map((name) => ({ id: uid(), name }));
  const catId = (n) => categories.find((c) => c.name === n).id;

  const productSeed = [
    { sku: "CHG-001", name: "Fast Charger 20W (Type-C)", category: "Chargers", cost: 180, price: 350, q1: 24, q2: 10, min: 5, warranty: 30 },
    { sku: "CBL-001", name: "USB-C Cable 1m", category: "Cables", cost: 45, price: 120, q1: 40, q2: 18, min: 10, warranty: 7 },
    { sku: "EAR-001", name: "TWS Earbuds", category: "Audio", cost: 320, price: 650, q1: 12, q2: 6, min: 4, warranty: 90 },
    { sku: "TGL-001", name: "Tempered Glass (Universal)", category: "Accessories", cost: 25, price: 99, q1: 60, q2: 25, min: 15, warranty: 0 },
    { sku: "PWB-001", name: "Power Bank 10,000mAh", category: "Power", cost: 450, price: 850, q1: 8, q2: 3, min: 3, warranty: 180 },
  ];
  const products = [];
  const branch_inventory = {};
  for (const p of productSeed) {
    const id = uid();
    products.push({
      id, sku: p.sku, barcode: p.sku, name: p.name, category_id: catId(p.category), brand: null, image: null,
      cost_price: p.cost, selling_price: p.price, warranty_days: p.warranty || 0, is_active: true, created_at: now(),
    });
    branch_inventory[invKey(branch1, id)] = { branch_id: branch1, product_id: id, quantity: p.q1, min_stock: p.min, updated_at: now() };
    branch_inventory[invKey(branch2, id)] = { branch_id: branch2, product_id: id, quantity: p.q2, min_stock: p.min, updated_at: now() };
  }

  return {
    activeBranchId: branch1,
    currentUserId: ownerId,
    seq: { sale: 0, po: 0, transfer: 0, claim: 0 },
    branches: [
      { id: branch1, name: "My Electronics Shop", address: null, city: "Manila", phone: null, is_active: true, opened_at: null, created_at: now() },
      { id: branch2, name: "Branch 2 — Cavite", address: null, city: "Cavite", phone: null, is_active: true, opened_at: null, created_at: now() },
    ],
    app_users: [
      { id: ownerId, username: "owner", full_name: "Shop Owner", role: "owner", branch_id: null, phone: null, is_active: true, created_at: now() },
      { id: techId, username: "tech1", full_name: "Technician 1", role: "staff", branch_id: branch1, phone: null, is_active: true, created_at: now() },
      { id: staffId, username: "staff1", full_name: "Counter Staff", role: "staff", branch_id: branch1, phone: null, is_active: true, created_at: now() },
    ],
    customers: [
      { id: uid(), name: "Juan dela Cruz", phone: "0917 000 1111", notes: null, created_at: now() },
      { id: uid(), name: "Maria Santos", phone: "0918 222 3333", notes: "Prefers GCash", created_at: now() },
    ],
    categories,
    products,
    branch_inventory,
    stock_movements: [],
    sales: [],
    sale_items: [],
    cash_reconciliations: [],
    suppliers: [],
    purchase_orders: [],
    purchase_order_items: [],
    stock_transfers: [],
    stock_transfer_items: [],
    service_jobs: [],
    fund_movements: [],
    bills: [],
    ratings: [],
  };
}

let db = load();
migrate();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const s = seed();
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}

// Tolerate older saved shapes by filling in any missing collections.
function migrate() {
  const defaults = {
    customers: [], stock_transfers: [], stock_transfer_items: [],
  };
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) if (!db[k]) { db[k] = v; changed = true; }
  if (!db.seq) { db.seq = { sale: 0, po: 0, transfer: 0, claim: 0 }; changed = true; }
  else for (const k of ["transfer", "claim"]) if (db.seq[k] == null) { db.seq[k] = 0; changed = true; }
  if (!db.activeBranchId) { db.activeBranchId = db.branches?.[0]?.id; changed = true; }
  if (changed) persist();
}

export function getDB() {
  return db;
}
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ }
}
export function resetDB() {
  db = seed();
  persist();
  return db;
}

// current "logged-in" user in no-login mode
export function currentUser() {
  return db.app_users.find((u) => u.id === db.currentUserId) || db.app_users[0];
}
