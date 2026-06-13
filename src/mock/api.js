/* ------------------------------------------------------------
   Mock API for standalone mode. Pattern-matches the same paths the real
   Express server exposes and returns the same response shapes, computing
   over the localStorage store. All stock changes still go through
   "movements" + inventory updates, mirroring the server's design.
   ------------------------------------------------------------ */
import { getDB, persist, resetDB, currentUser, uid, now, invKey } from "./store.js";

const PH = "Asia/Manila";
const phDateStr = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: PH });
const todayPH = () => new Date().toLocaleDateString("en-CA", { timeZone: PH });
const phParts = (ts) => new Date(new Date(ts).toLocaleString("en-US", { timeZone: PH }));
const sameMonth = (ts) => {
  const a = phParts(ts), b = phParts(Date.now());
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const db = () => getDB();
let _ctxBranch = null; // resolved per request
const activeBranch = () => _ctxBranch || db().activeBranchId;
const userName = (id) => db().app_users.find((u) => u.id === id)?.full_name || "—";
const branchName = (id) => db().branches.find((x) => x.id === id)?.name || "—";
const inv = (pid, b = activeBranch()) => db().branch_inventory[invKey(b, pid)];

function applyMovement({ branch = activeBranch(), productId, type, quantity, referenceId = null, reason = null }) {
  const d = db();
  d.stock_movements.push({
    id: uid(), branch_id: branch, product_id: productId, movement_type: type,
    quantity, reference_id: referenceId, reason, performed_by: d.currentUserId, created_at: now(),
  });
  const key = invKey(branch, productId);
  const row = d.branch_inventory[key] || (d.branch_inventory[key] = { branch_id: branch, product_id: productId, quantity: 0, min_stock: 3, updated_at: now() });
  const next = row.quantity + quantity;
  if (next < 0) fail(400, "That would put stock below zero");
  row.quantity = next; row.updated_at = now();
  return next;
}

// ---------- read helpers ----------
function inventoryList(b = activeBranch()) {
  const d = db();
  return d.products.filter((p) => p.is_active).map((p) => {
    const i = inv(p.id, b);
    const cat = d.categories.find((c) => c.id === p.category_id);
    return {
      product_id: p.id, sku: p.sku, barcode: p.barcode || p.sku, name: p.name, brand: p.brand, image: p.image || null,
      cost_price: p.cost_price, selling_price: p.selling_price, warranty_days: p.warranty_days || 0, category: cat?.name || null,
      quantity: i?.quantity ?? 0, min_stock: i?.min_stock ?? 3,
    };
  }).sort((a, b2) => a.name.localeCompare(b2.name));
}

function salesList() {
  const d = db();
  return d.sales.filter((s) => s.branch_id === activeBranch())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 200)
    .map((s) => ({
      ...s, sold_by_name: userName(s.sold_by),
      items: d.sale_items.filter((i) => i.sale_id === s.id).map((i) => ({
        product_id: i.product_id, name: d.products.find((p) => p.id === i.product_id)?.name || "—",
        quantity: i.quantity, unit_price: i.unit_price, warranty_days: i.warranty_days || 0,
      })),
    }));
}

function createSale(body) {
  const d = db();
  const items = body?.items || [];
  if (!items.length) fail(400, "Cart is empty");
  let subtotal = 0;
  for (const it of items) {
    const p = d.products.find((x) => x.id === it.product_id);
    if (!p) fail(400, "A product in the cart no longer exists");
    const q = parseInt(it.quantity, 10);
    if (!q || q <= 0) fail(400, "Invalid quantity");
    if (q > (inv(p.id)?.quantity ?? 0)) fail(400, "Not enough stock for one of the items");
    subtotal += Number(p.selling_price) * q;
  }
  const discount = Math.max(0, Math.min(Number(body.discount) || 0, subtotal));
  const total = subtotal - discount;
  const sale = {
    id: uid(), branch_id: activeBranch(), sale_number: ++d.seq.sale, subtotal, discount,
    total_amount: total, payment_method: body.payment_method || "cash", is_voided: false,
    void_reason: null, voided_by: null, sold_by: d.currentUserId, created_at: now(),
  };
  d.sales.push(sale);
  for (const it of items) {
    const p = d.products.find((x) => x.id === it.product_id);
    const q = parseInt(it.quantity, 10);
    d.sale_items.push({ id: uid(), sale_id: sale.id, product_id: p.id, quantity: q, unit_price: p.selling_price, unit_cost: p.cost_price, warranty_days: p.warranty_days || 0 });
    applyMovement({ productId: p.id, type: "sale", quantity: -q, referenceId: sale.id });
  }
  persist();
  return sale;
}

function voidSale(id, body) {
  const d = db();
  const reason = (body?.reason || "").trim();
  if (!reason) fail(400, "A reason is required to void a sale");
  const sale = d.sales.find((s) => s.id === id);
  if (!sale) fail(404, "Sale not found");
  if (sale.is_voided) fail(400, "This sale is already voided");
  for (const line of d.sale_items.filter((i) => i.sale_id === id))
    applyMovement({ branch: sale.branch_id, productId: line.product_id, type: "return_in", quantity: line.quantity, referenceId: id, reason: "Void: " + reason });
  sale.is_voided = true; sale.void_reason = reason; sale.voided_by = d.currentUserId;
  persist();
  return { ok: true };
}

function servicesList() {
  const d = db();
  return d.service_jobs.filter((j) => j.branch_id === activeBranch())
    .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    .map((j) => ({ ...j, tech_name: j.tech_id ? userName(j.tech_id) : null, balance: Number(j.fee) - Number(j.amount_paid || 0) }));
}

function poList() {
  const d = db();
  return d.purchase_orders.filter((po) => po.branch_id === activeBranch())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((po) => ({
      ...po,
      supplier_name: d.suppliers.find((s) => s.id === po.supplier_id)?.name || "—",
      created_by_name: userName(po.created_by),
      items: d.purchase_order_items.filter((i) => i.po_id === po.id).map((i) => ({
        id: i.id, product_id: i.product_id, name: d.products.find((p) => p.id === i.product_id)?.name || "—",
        qty_ordered: i.qty_ordered, qty_received: i.qty_received, unit_cost: i.unit_cost,
      })),
    }));
}

function transfersList() {
  const d = db();
  const b = activeBranch();
  return d.stock_transfers.filter((t) => t.from_branch_id === b || t.to_branch_id === b)
    .sort((a, b2) => new Date(b2.created_at) - new Date(a.created_at))
    .map((t) => ({
      ...t,
      from_branch_name: branchName(t.from_branch_id), to_branch_name: branchName(t.to_branch_id),
      requested_by_name: userName(t.requested_by), direction: t.from_branch_id === b ? "out" : "in",
      items: d.stock_transfer_items.filter((i) => i.transfer_id === t.id).map((i) => ({
        id: i.id, product_id: i.product_id, name: d.products.find((p) => p.id === i.product_id)?.name || "—", quantity: i.quantity,
      })),
    }));
}

function fundsList() {
  const d = db();
  const movements = d.fund_movements.filter((f) => f.branch_id === activeBranch())
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((m) => ({ ...m, performed_by_name: userName(m.performed_by) }));
  const totals = movements.reduce((a, r) => {
    if (r.direction === "in") a.in += Number(r.amount); else a.out += Number(r.amount); return a;
  }, { in: 0, out: 0 });
  return { movements, totals: { ...totals, balance: totals.in - totals.out } };
}

function billsList() {
  const d = db();
  return d.bills.filter((b) => b.branch_id === activeBranch())
    .sort((a, b) => (a.is_paid - b.is_paid) || new Date(b.created_at) - new Date(a.created_at));
}

function expectedCashToday() {
  const d = db();
  return d.sales.filter((s) => s.branch_id === activeBranch() && !s.is_voided && s.payment_method === "cash" && phDateStr(s.created_at) === todayPH())
    .reduce((a, s) => a + Number(s.total_amount), 0);
}

function closingsGet() {
  const d = db();
  const history = d.cash_reconciliations.filter((c) => c.branch_id === activeBranch())
    .sort((a, b) => (a.business_date < b.business_date ? 1 : -1))
    .map((c) => ({ ...c, closed_by_name: userName(c.closed_by), variance: Number(c.counted_cash) - Number(c.expected_cash) }));
  const today = todayPH();
  return { expected_cash: expectedCashToday(), closed_today: history.some((h) => h.business_date === today), today, history };
}

function ratingsGet() {
  const d = db();
  const ratings = d.ratings.filter((r) => r.branch_id === activeBranch()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const count = ratings.length;
  const average = count ? Number((ratings.reduce((a, r) => a + r.stars, 0) / count).toFixed(1)) : null;
  return { ratings, count, average };
}

function dashboard() {
  const d = db();
  const b = activeBranch();
  const todays = d.sales.filter((s) => s.branch_id === b && !s.is_voided && phDateStr(s.created_at) === todayPH());
  const today = {
    total: todays.reduce((a, s) => a + Number(s.total_amount), 0),
    cash: todays.filter((s) => s.payment_method === "cash").reduce((a, s) => a + Number(s.total_amount), 0),
    transactions: todays.length,
  };
  const low_stock = inventoryList(b).filter((p) => p.quantity <= p.min_stock)
    .map((p) => ({ product: p.name, sku: p.sku, quantity: p.quantity, min_stock: p.min_stock }));
  const open_jobs = d.service_jobs.filter((j) => j.branch_id === b && j.status !== "released").length;
  const unpaid_bills = d.bills.filter((x) => x.branch_id === b && !x.is_paid).map((x) => ({ id: x.id, name: x.name, amount: x.amount }));
  const week = Date.now() - 7 * 864e5;
  const red_flags = [
    ...d.sales.filter((s) => s.branch_id === b && s.is_voided && new Date(s.created_at).getTime() > week)
      .map((s) => ({ flag_type: "voided_sale", created_at: s.created_at, by_user: userName(s.voided_by || s.sold_by), amount: Number(s.total_amount), detail: s.void_reason })),
    ...d.stock_movements.filter((m) => m.branch_id === b && m.movement_type === "adjustment" && new Date(m.created_at).getTime() > week)
      .map((m) => ({ flag_type: "stock_adjustment", created_at: m.created_at, by_user: userName(m.performed_by), amount: m.quantity, detail: m.reason })),
  ].sort((a, b2) => new Date(b2.created_at) - new Date(a.created_at));
  const r = ratingsGet();
  return {
    today, low_stock, open_jobs, unpaid_bills, red_flags,
    avg_rating: r.average, rating_count: r.count, closed_today: closingsGet().closed_today,
  };
}

function charts() {
  const d = db();
  const b = activeBranch();
  const sales = d.sales.filter((s) => s.branch_id === b && !s.is_voided);
  // last 14 days trend
  const sales_trend = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5);
    const key = phDateStr(day);
    const total = sales.filter((s) => phDateStr(s.created_at) === key).reduce((a, s) => a + Number(s.total_amount), 0);
    sales_trend.push({ date: key, label: new Date(day).toLocaleDateString("en-PH", { timeZone: PH, month: "short", day: "numeric" }), total });
  }
  // top products this month
  const monthSaleIds = new Set(sales.filter((s) => sameMonth(s.created_at)).map((s) => s.id));
  const agg = {};
  for (const i of d.sale_items.filter((x) => monthSaleIds.has(x.sale_id))) {
    const a = (agg[i.product_id] ||= { name: d.products.find((p) => p.id === i.product_id)?.name || "—", qty: 0, revenue: 0 });
    a.qty += i.quantity; a.revenue += Number(i.unit_price) * i.quantity;
  }
  const top_products = Object.values(agg).sort((a, b2) => b2.revenue - a.revenue).slice(0, 5);
  return { sales_trend, top_products };
}

function performance() {
  const d = db();
  const b = activeBranch();
  const ms = d.sales.filter((s) => s.branch_id === b && !s.is_voided && sameMonth(s.created_at));
  const revenue = ms.reduce((a, s) => a + Number(s.total_amount), 0);
  const saleIds = new Set(ms.map((s) => s.id));
  const cogs = d.sale_items.filter((i) => saleIds.has(i.sale_id)).reduce((a, i) => a + Number(i.unit_cost) * i.quantity, 0);
  const releasedThisMonth = d.service_jobs.filter((j) => j.branch_id === b && j.status === "released" && j.released_at && sameMonth(j.released_at));
  const service_income = releasedThisMonth.reduce((a, j) => a + Number(j.fee), 0);
  const bills_paid = d.bills.filter((x) => x.branch_id === b && x.is_paid && x.paid_at && sameMonth(x.paid_at)).reduce((a, x) => a + Number(x.amount), 0);

  const staff = d.app_users.filter((u) => u.is_active && (u.branch_id === b || u.branch_id === null)).map((u) => {
    const us = ms.filter((s) => s.sold_by === u.id);
    const uj = releasedThisMonth.filter((j) => j.tech_id === u.id);
    return {
      id: u.id, full_name: u.full_name, role: u.role,
      sales_total: us.reduce((a, s) => a + Number(s.total_amount), 0), sales_count: us.length,
      jobs_done: uj.length, service_income: uj.reduce((a, j) => a + Number(j.fee), 0),
    };
  }).sort((a, b2) => b2.sales_total - a.sales_total);

  return { pl: { revenue, cogs, service_income, bills_paid, profit: revenue - cogs + service_income - bills_paid }, staff };
}

function customersList(q) {
  const d = db();
  const term = (q || "").toLowerCase();
  return d.customers.filter((c) => !term || c.name.toLowerCase().includes(term) || (c.phone || "").includes(term))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ...c, visits: d.service_jobs.filter((j) => j.customer_id === c.id).length }));
}

function customerDetail(id) {
  const d = db();
  const customer = d.customers.find((c) => c.id === id);
  if (!customer) fail(404, "Customer not found");
  const jobs = d.service_jobs.filter((j) => j.customer_id === id)
    .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    .map((j) => ({ ...j, tech_name: j.tech_id ? userName(j.tech_id) : null, balance: Number(j.fee) - Number(j.amount_paid || 0) }));
  const total_spent = jobs.reduce((a, j) => a + Number(j.amount_paid || 0), 0);
  return { customer, jobs, total_spent };
}

// ---------- router ----------
export async function mockRequest(method, path, body) {
  const d = db();
  const [rawPath, queryStr] = path.split("?");
  const query = Object.fromEntries(new URLSearchParams(queryStr || ""));
  _ctxBranch = query.branch || body?.branch_id || d.activeBranchId;
  const seg = rawPath.split("/").filter(Boolean);
  const [a, b, c] = seg;
  const M = method.toUpperCase();

  if (a === "auth" && b === "me") return { user: currentUser() };
  if (a === "auth" && b === "login") return { token: "mock", user: currentUser() };

  if (a === "dev" && b === "reset" && M === "POST") { resetDB(); return { ok: true }; }

  if (a === "branches") {
    if (M === "GET") return d.branches.filter((x) => x.is_active);
    if (M === "POST" && !b) {
      if (!body.name) fail(400, "Branch name is required");
      const br = { id: uid(), name: body.name, address: body.address || null, city: body.city || null, phone: body.phone || null, is_active: true, opened_at: null, created_at: now() };
      d.branches.push(br); persist(); return br;
    }
    if (M === "PATCH") {
      const br = d.branches.find((x) => x.id === b);
      if (br) Object.assign(br, { name: body.name ?? br.name, address: body.address ?? br.address, city: body.city ?? br.city, phone: body.phone ?? br.phone });
      persist(); return br;
    }
  }

  if (a === "staff") {
    if (M === "GET") return d.app_users.map(({ ...u }) => u);
    if (M === "POST" && !b) {
      if (!body.full_name) fail(400, "Name is required");
      if (!body.username || !body.password) fail(400, "Username and password are required");
      if (d.app_users.some((u) => u.username.toLowerCase() === body.username.toLowerCase())) fail(409, "That username is already taken");
      const u = { id: uid(), username: body.username, full_name: body.full_name, role: body.role || "staff", branch_id: body.branch_id || activeBranch(), phone: body.phone || null, is_active: true, created_at: now() };
      d.app_users.push(u); persist(); return u;
    }
    if (M === "POST" && c === "password") { persist(); return { ok: true }; }
    if (M === "DELETE") { const u = d.app_users.find((x) => x.id === b); if (u) u.is_active = false; persist(); return { ok: true }; }
  }

  if (a === "customers") {
    if (M === "GET" && b) return customerDetail(b);
    if (M === "GET") return customersList(query.q);
    if (M === "POST") {
      if (!body.name) fail(400, "Customer name is required");
      const c2 = { id: uid(), name: body.name, phone: body.phone || null, notes: body.notes || null, created_at: now() };
      d.customers.push(c2); persist(); return c2;
    }
  }

  if (a === "products") {
    if (b === "categories") return d.categories.slice().sort((x, y) => x.name.localeCompare(y.name));
    if (M === "GET") return d.products.filter((p) => p.is_active);
    if (M === "POST") {
      if (!body.sku || !body.name) fail(400, "SKU and product name are required");
      if (d.products.some((p) => p.sku.toLowerCase() === body.sku.toLowerCase())) fail(409, "A product with that SKU already exists");
      let catId = null;
      if (body.category) {
        let cat = d.categories.find((x) => x.name.toLowerCase() === body.category.toLowerCase());
        if (!cat) { cat = { id: uid(), name: body.category }; d.categories.push(cat); }
        catId = cat.id;
      }
      const p = { id: uid(), sku: body.sku, barcode: body.barcode || body.sku, name: body.name, category_id: catId, brand: body.brand || null, image: body.image || null, cost_price: +body.cost_price || 0, selling_price: +body.selling_price || 0, warranty_days: parseInt(body.warranty_days, 10) || 0, is_active: true, created_at: now() };
      d.products.push(p);
      d.branch_inventory[invKey(activeBranch(), p.id)] = { branch_id: activeBranch(), product_id: p.id, quantity: +body.qty || 0, min_stock: +body.min_stock || 3, updated_at: now() };
      persist(); return p;
    }
    if (M === "PATCH") {
      const p = d.products.find((x) => x.id === b);
      if (p) Object.assign(p, { name: body.name ?? p.name, cost_price: body.cost_price ?? p.cost_price, selling_price: body.selling_price ?? p.selling_price, brand: body.brand ?? p.brand, barcode: body.barcode ?? p.barcode, image: body.image ?? p.image, warranty_days: body.warranty_days === undefined ? p.warranty_days : (parseInt(body.warranty_days, 10) || 0) });
      persist(); return p;
    }
    if (M === "DELETE") { const p = d.products.find((x) => x.id === b); if (p) p.is_active = false; persist(); return { ok: true }; }
  }

  if (a === "inventory") {
    if (M === "GET") return inventoryList();
    if (M === "POST" && c === "restock") {
      const q = parseInt(body.quantity, 10); if (!q || q <= 0) fail(400, "Enter a positive quantity");
      const quantity = applyMovement({ productId: b, type: "purchase_in", quantity: q, reason: body.reason || "Supplier delivery" }); persist(); return { ok: true, quantity };
    }
    if (M === "POST" && c === "adjust") {
      const delta = parseInt(body.delta, 10); const reason = (body.reason || "").trim();
      if (!delta) fail(400, "Enter a non-zero adjustment (e.g. +10 or -2)");
      if (!reason) fail(400, "A reason is required for stock adjustments");
      const quantity = applyMovement({ productId: b, type: "adjustment", quantity: delta, reason }); persist(); return { ok: true, quantity };
    }
    if (M === "POST" && c === "min-stock") {
      const min = parseInt(body.min_stock, 10); if (isNaN(min) || min < 0) fail(400, "Invalid minimum");
      const key = invKey(activeBranch(), b);
      (d.branch_inventory[key] || (d.branch_inventory[key] = { branch_id: activeBranch(), product_id: b, quantity: 0, min_stock: 3, updated_at: now() })).min_stock = min;
      persist(); return { ok: true };
    }
  }

  if (a === "sales") {
    if (M === "GET") return salesList();
    if (M === "POST" && b && c === "void") return voidSale(b, body);
    if (M === "POST") return createSale(body);
  }

  if (a === "services") {
    if (M === "GET") return servicesList();
    if (M === "POST" && b && c === "payment") {
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      const amt = Number(body.amount); if (!amt || amt <= 0) fail(400, "Enter a positive amount");
      j.amount_paid = Math.min(Number(j.fee), Number(j.amount_paid || 0) + amt); persist();
      return { ...j, balance: Number(j.fee) - Number(j.amount_paid) };
    }
    if (M === "POST") {
      if (!body.customer && !body.customer_id) fail(400, "Customer is required");
      if (!body.device) fail(400, "Device is required");
      const cust = body.customer_id ? d.customers.find((c2) => c2.id === body.customer_id) : null;
      const j = {
        id: uid(), branch_id: activeBranch(), claim_number: ++d.seq.claim,
        customer_id: body.customer_id || null, customer: cust?.name || body.customer,
        phone: body.phone || cust?.phone || null, device: body.device,
        model_number: body.model_number || null, serial_code: body.serial_code || null, issue: body.issue || null,
        fee: +body.fee || 0, amount_paid: 0, status: "received", tech_id: body.tech_id || null,
        images: Array.isArray(body.images) ? body.images : [],
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        parts_replaced: [], before_photos: [], after_photos: [], video_links: [],
        customer_details: body.customer_details || null, tech_notes: body.tech_notes || null,
        notes: body.notes || null, remarks: body.remarks || null, instructions: body.instructions || null,
        warranty_days: parseInt(body.warranty_days, 10) || 0,
        received_at: now(), released_at: null, created_at: now(),
      };
      d.service_jobs.push(j); persist(); return j;
    }
    if (M === "PATCH" && c === "details") {
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      for (const k of ["model_number", "serial_code", "issue", "customer_details", "tech_notes", "notes", "remarks", "instructions"])
        if (body[k] !== undefined) j[k] = body[k];
      if (body.warranty_days !== undefined) j.warranty_days = parseInt(body.warranty_days, 10) || 0;
      persist(); return j;
    }
    if (M === "PATCH" && c === "status") {
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      j.status = body.status;
      if (body.status === "ready_for_pickup" && !j.ready_at) j.ready_at = now();
      if (body.status === "released" && !j.released_at) j.released_at = now();
      persist(); return j;
    }
    if (M === "PATCH" && c === "images") {
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      if (!Array.isArray(body.images)) fail(400, "images must be an array");
      j.images = body.images; persist(); return j;
    }
    if (M === "PATCH" && c === "attachments") {
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      if (!Array.isArray(body.attachments)) fail(400, "attachments must be an array");
      j.attachments = body.attachments; persist(); return j;
    }
    if (M === "PATCH" && c === "extras") {
      // Repair documentation arrays: parts replaced, before/after photos, video links.
      const j = d.service_jobs.find((x) => x.id === b); if (!j) fail(404, "Job not found");
      for (const k of ["parts_replaced", "before_photos", "after_photos", "video_links"]) {
        if (body[k] === undefined) continue;
        if (!Array.isArray(body[k])) fail(400, `${k} must be an array`);
        j[k] = body[k];
      }
      persist(); return j;
    }
  }

  if (a === "purchase-orders") {
    if (M === "GET") return poList();
    if (M === "POST" && b && c === "receive") {
      const po = d.purchase_orders.find((x) => x.id === b); if (!po) fail(404, "Order not found");
      if (po.status === "received") fail(400, "This order is already received");
      if (po.status === "cancelled") fail(400, "This order was cancelled");
      for (const line of d.purchase_order_items.filter((i) => i.po_id === po.id)) {
        const outstanding = line.qty_ordered - line.qty_received; if (outstanding <= 0) continue;
        applyMovement({ branch: po.branch_id, productId: line.product_id, type: "purchase_in", quantity: outstanding, referenceId: po.id, reason: "Materials order received" });
        line.qty_received = line.qty_ordered;
      }
      po.status = "received"; po.received_at = now(); persist(); return { ok: true };
    }
    if (M === "POST" && b && c === "cancel") {
      const po = d.purchase_orders.find((x) => x.id === b);
      if (!po || po.status === "received") fail(400, "Can't cancel — order not found or already received");
      po.status = "cancelled"; persist(); return { ok: true };
    }
    if (M === "POST") {
      if (!body.supplier_id) fail(400, "Choose a supplier");
      const items = body.items || []; if (!items.length) fail(400, "Add at least one item");
      let total = 0; for (const it of items) { const q = parseInt(it.qty_ordered, 10); if (!q || q <= 0) fail(400, "Invalid order quantity"); total += Number(it.unit_cost || 0) * q; }
      const po = { id: uid(), branch_id: activeBranch(), supplier_id: body.supplier_id, po_number: ++d.seq.po, status: "ordered", total_cost: total, notes: body.notes || null, created_by: d.currentUserId, created_at: now(), received_at: null };
      d.purchase_orders.push(po);
      for (const it of items) d.purchase_order_items.push({ id: uid(), po_id: po.id, product_id: it.product_id, qty_ordered: parseInt(it.qty_ordered, 10), qty_received: 0, unit_cost: Number(it.unit_cost || 0) });
      persist(); return po;
    }
  }

  if (a === "transfers") {
    if (M === "GET") return transfersList();
    if (M === "POST" && b && c === "receive") {
      const t = d.stock_transfers.find((x) => x.id === b); if (!t) fail(404, "Transfer not found");
      if (t.status === "received") fail(400, "Already received");
      if (t.status === "cancelled") fail(400, "Transfer was cancelled");
      for (const line of d.stock_transfer_items.filter((i) => i.transfer_id === t.id))
        applyMovement({ branch: t.to_branch_id, productId: line.product_id, type: "transfer_in", quantity: line.quantity, referenceId: t.id, reason: "Transfer received" });
      t.status = "received"; t.received_at = now(); t.received_by = d.currentUserId; persist(); return { ok: true };
    }
    if (M === "POST" && b && c === "cancel") {
      const t = d.stock_transfers.find((x) => x.id === b); if (!t || t.status === "received") fail(400, "Can't cancel — not found or already received");
      // return the in-transit stock to source
      for (const line of d.stock_transfer_items.filter((i) => i.transfer_id === t.id))
        applyMovement({ branch: t.from_branch_id, productId: line.product_id, type: "transfer_in", quantity: line.quantity, referenceId: t.id, reason: "Transfer cancelled — returned" });
      t.status = "cancelled"; persist(); return { ok: true };
    }
    if (M === "POST") {
      const from = activeBranch();
      if (!body.to_branch_id || body.to_branch_id === from) fail(400, "Choose a different destination branch");
      const items = body.items || []; if (!items.length) fail(400, "Add at least one item");
      for (const it of items) {
        const q = parseInt(it.quantity, 10); if (!q || q <= 0) fail(400, "Invalid quantity");
        if (q > (inv(it.product_id, from)?.quantity ?? 0)) fail(400, "Not enough stock at the source branch");
      }
      const t = { id: uid(), transfer_number: ++d.seq.transfer, from_branch_id: from, to_branch_id: body.to_branch_id, status: "in_transit", requested_by: d.currentUserId, received_by: null, created_at: now(), received_at: null };
      d.stock_transfers.push(t);
      for (const it of items) {
        const q = parseInt(it.quantity, 10);
        d.stock_transfer_items.push({ id: uid(), transfer_id: t.id, product_id: it.product_id, quantity: q });
        applyMovement({ branch: from, productId: it.product_id, type: "transfer_out", quantity: -q, referenceId: t.id, reason: "Transfer out" });
      }
      persist(); return t;
    }
  }

  if (a === "suppliers") {
    if (M === "GET") return d.suppliers.filter((s) => s.is_active).sort((x, y) => x.name.localeCompare(y.name));
    if (M === "POST") {
      if (!body.name) fail(400, "Supplier name is required");
      const s = { id: uid(), name: body.name, contact: body.contact || null, phone: body.phone || null, notes: body.notes || null, is_active: true };
      d.suppliers.push(s); persist(); return s;
    }
  }

  if (a === "funds") {
    if (M === "GET") return fundsList();
    if (M === "POST") {
      const amt = Number(body.amount); if (!amt || amt <= 0) fail(400, "Enter a positive amount");
      const f = { id: uid(), branch_id: activeBranch(), direction: body.direction, category: body.category || "other", amount: amt, notes: body.notes || null, performed_by: d.currentUserId, created_at: now() };
      d.fund_movements.push(f); persist(); return f;
    }
  }

  if (a === "bills") {
    if (M === "GET") return billsList();
    if (M === "POST") {
      if (!body.name || !body.amount) fail(400, "Bill name and amount are required");
      const bill = { id: uid(), branch_id: activeBranch(), name: body.name, category: body.category || "Utilities", amount: Number(body.amount), due_date: body.due_date || null, is_paid: false, paid_at: null, created_at: now() };
      d.bills.push(bill); persist(); return bill;
    }
    if (M === "PATCH" && c === "paid") {
      const bill = d.bills.find((x) => x.id === b); if (!bill) fail(404, "Bill not found");
      bill.is_paid = !!body.paid; bill.paid_at = bill.is_paid ? now() : null; persist(); return bill;
    }
  }

  if (a === "closings") {
    if (M === "GET") return closingsGet();
    if (M === "POST") {
      const counted = Number(body.counted_cash); if (isNaN(counted)) fail(400, "Enter the counted cash amount");
      const today = todayPH();
      if (d.cash_reconciliations.some((c2) => c2.branch_id === activeBranch() && c2.business_date === today)) fail(409, "Today is already closed for this branch");
      const rec = { id: uid(), branch_id: activeBranch(), business_date: today, expected_cash: expectedCashToday(), counted_cash: counted, notes: body.notes || null, photo_url: null, closed_by: d.currentUserId, created_at: now() };
      d.cash_reconciliations.push(rec); persist(); return rec;
    }
  }

  if (a === "ratings") {
    if (M === "GET") return ratingsGet();
    if (M === "POST") {
      const stars = parseInt(body.stars, 10); if (!(stars >= 1 && stars <= 5)) fail(400, "Stars must be 1–5");
      const r = { id: uid(), branch_id: activeBranch(), stars, customer_name: body.customer_name || null, comment: body.comment || null, created_at: now() };
      d.ratings.push(r); persist(); return r;
    }
  }

  if (a === "dashboard") {
    if (b === "performance") return performance();
    if (b === "charts") return charts();
    return dashboard();
  }

  throw new HttpError(404, `Mock: no handler for ${method} ${path}`);
}
