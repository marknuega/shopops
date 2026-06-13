/* ------------------------------------------------------------
   Client-side Excel report generation for standalone mode.
   Mirrors the server's 6 reports (same columns/totals) but builds the
   workbook in the browser with exceljs and triggers a download.
   ------------------------------------------------------------ */
import { getDB } from "./store.js";

// exceljs is large and only needed when a report is actually downloaded,
// so load it on demand to keep the initial bundle small.
let _ExcelJS;
const loadExcel = async () => (_ExcelJS ||= (await import("exceljs")).default);

const PH = "Asia/Manila";
const INK = "FF15323B";
const fmtDT = (ts) => (ts ? new Date(ts).toLocaleString("en-PH", { timeZone: PH, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: PH }) : "");
const inRange = (ts, from, to) => {
  const d = fmtDate(ts);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

async function build(columns, rows, opts) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "ShopOps";
  const ws = wb.addWorksheet(opts.sheetName || "Report", { views: [{ state: "frozen", ySplit: 3 }] });

  ws.mergeCells(1, 1, 1, columns.length);
  const t = ws.getCell(1, 1); t.value = opts.title; t.font = { bold: true, size: 14, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, columns.length);
  const s = ws.getCell(2, 1); s.value = `Generated ${new Date().toLocaleString("en-PH", { timeZone: PH })}`; s.font = { size: 9, color: { argb: "FF5C6B70" } };

  ws.columns = columns.map((c) => ({ key: c.key, width: c.width || 16 }));
  const header = ws.getRow(3);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: c.money || c.number ? "right" : "left" };
  });
  rows.forEach((r) => {
    const row = ws.addRow(r);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.money) { cell.numFmt = '"₱"#,##0.00'; cell.alignment = { horizontal: "right" }; }
      else if (c.number) cell.alignment = { horizontal: "right" };
    });
  });
  if (opts.totals) {
    const tr = ws.addRow(opts.totals); tr.font = { bold: true };
    tr.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBEED7" } }; });
    columns.forEach((c, i) => { if (c.money && opts.totals[c.key] != null) tr.getCell(i + 1).numFmt = '"₱"#,##0.00'; });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${opts.file}_${fmtDate(Date.now())}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function mockDownloadReport(type, params = {}) {
  const d = getDB();
  const branchId = params.branch || d.activeBranchId;
  const from = params.from, to = params.to;
  const uName = (id) => d.app_users.find((u) => u.id === id)?.full_name || "—";
  const pName = (id) => d.products.find((p) => p.id === id)?.name || "—";

  if (type === "repair-logs") {
    const rows = d.service_jobs.filter((j) => j.branch_id === branchId && inRange(j.received_at, from, to))
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .map((j) => ({ received: fmtDT(j.received_at), customer: j.customer, phone: j.phone || "", device: j.device, issue: j.issue || "", tech: j.tech_id ? uName(j.tech_id) : "Unassigned", fee: Number(j.fee), status: j.status, released: fmtDT(j.released_at) }));
    return build(
      [{ header: "Received", key: "received", width: 20 }, { header: "Customer", key: "customer", width: 20 }, { header: "Contact", key: "phone", width: 16 }, { header: "Device", key: "device", width: 24 }, { header: "Issue", key: "issue", width: 30 }, { header: "Technician", key: "tech", width: 18 }, { header: "Fee", key: "fee", width: 12, money: true }, { header: "Status", key: "status", width: 16 }, { header: "Released", key: "released", width: 20 }],
      rows, { sheetName: "Repair logs", title: "Repair / Service Logsheet", file: "repair-logs", totals: { device: `${rows.length} jobs`, fee: rows.reduce((a, r) => a + r.fee, 0) } }
    );
  }

  if (type === "sales") {
    const rows = [];
    let grand = 0;
    d.sales.filter((s) => s.branch_id === branchId && inRange(s.created_at, from, to))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((s) => {
        const items = d.sale_items.filter((i) => i.sale_id === s.id);
        (items.length ? items : [null]).forEach((i) => {
          const line = s.is_voided || !i ? 0 : Number(i.unit_price) * i.quantity;
          grand += line;
          rows.push({ no: s.sale_number, date: fmtDT(s.created_at), item: i ? pName(i.product_id) : "—", qty: i?.quantity || 0, price: Number(i?.unit_price || 0), line, method: s.payment_method, soldby: uName(s.sold_by), voided: s.is_voided ? `VOIDED — ${s.void_reason || ""}` : "" });
        });
      });
    return build(
      [{ header: "Receipt #", key: "no", width: 12, number: true }, { header: "Date", key: "date", width: 20 }, { header: "Item", key: "item", width: 28 }, { header: "Qty", key: "qty", width: 8, number: true }, { header: "Unit price", key: "price", width: 14, money: true }, { header: "Line total", key: "line", width: 14, money: true }, { header: "Payment", key: "method", width: 12 }, { header: "Sold by", key: "soldby", width: 18 }, { header: "Voided", key: "voided", width: 22 }],
      rows, { sheetName: "Sales", title: "Sales Report", file: "sales", totals: { item: `${rows.length} line items`, line: grand } }
    );
  }

  if (type === "materials-orders") {
    const rows = [];
    let grand = 0;
    d.purchase_orders.filter((po) => po.branch_id === branchId && inRange(po.created_at, from, to))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((po) => {
        const supplier = d.suppliers.find((s) => s.id === po.supplier_id)?.name || "—";
        const items = d.purchase_order_items.filter((i) => i.po_id === po.id);
        (items.length ? items : [null]).forEach((i) => {
          const line = i ? Number(i.unit_cost) * i.qty_ordered : 0; grand += line;
          rows.push({ no: po.po_number, date: fmtDT(po.created_at), supplier, product: i ? pName(i.product_id) : "—", ord: i?.qty_ordered || 0, rec: i?.qty_received || 0, cost: Number(i?.unit_cost || 0), line, status: po.status, recv: fmtDT(po.received_at) });
        });
      });
    return build(
      [{ header: "PO #", key: "no", width: 10, number: true }, { header: "Ordered", key: "date", width: 20 }, { header: "Supplier", key: "supplier", width: 22 }, { header: "Product", key: "product", width: 28 }, { header: "Qty ordered", key: "ord", width: 12, number: true }, { header: "Qty received", key: "rec", width: 12, number: true }, { header: "Unit cost", key: "cost", width: 14, money: true }, { header: "Line cost", key: "line", width: 14, money: true }, { header: "Status", key: "status", width: 16 }, { header: "Received", key: "recv", width: 20 }],
      rows, { sheetName: "Materials orders", title: "Materials Orders (Purchase Orders)", file: "materials-orders", totals: { product: `${rows.length} lines`, line: grand } }
    );
  }

  if (type === "backlogs") {
    const ageDays = (dt) => Math.floor((Date.now() - new Date(dt).getTime()) / 864e5);
    const rows = [
      ...d.service_jobs.filter((j) => j.branch_id === branchId && j.status !== "released").map((j) => ({ type: "Open repair", since: fmtDT(j.received_at), age: ageDays(j.received_at), ref: j.customer, desc: `${j.device} — ${j.status}`, amount: Number(j.fee), owner: j.tech_id ? uName(j.tech_id) : "Unassigned" })),
      ...d.purchase_orders.filter((po) => po.branch_id === branchId && po.status !== "received" && po.status !== "cancelled").map((po) => ({ type: "Pending order", since: fmtDT(po.created_at), age: ageDays(po.created_at), ref: `PO #${po.po_number}`, desc: `${d.suppliers.find((s) => s.id === po.supplier_id)?.name || "—"} — ${po.status}`, amount: Number(po.total_cost || 0), owner: uName(po.created_by) })),
      ...d.bills.filter((b) => b.branch_id === branchId && !b.is_paid).map((b) => ({ type: "Unpaid bill", since: fmtDT(b.created_at), age: ageDays(b.created_at), ref: b.name, desc: `${b.category}${b.due_date ? " — due " + fmtDate(b.due_date) : ""}`, amount: Number(b.amount), owner: "" })),
    ].sort((a, b) => b.age - a.age);
    return build(
      [{ header: "Type", key: "type", width: 18 }, { header: "Since", key: "since", width: 20 }, { header: "Age (days)", key: "age", width: 12, number: true }, { header: "Reference", key: "ref", width: 26 }, { header: "Description", key: "desc", width: 30 }, { header: "Amount", key: "amount", width: 14, money: true }, { header: "Owner / note", key: "owner", width: 22 }],
      rows, { sheetName: "Backlogs", title: "Backlog — Outstanding Work", file: "backlogs", totals: { desc: `${rows.length} open items`, amount: rows.reduce((a, r) => a + r.amount, 0) } }
    );
  }

  if (type === "technician-productivity") {
    const released = d.service_jobs.filter((j) => j.branch_id === branchId && j.status === "released" && j.released_at && inRange(j.released_at, from, to));
    const sales = d.sales.filter((s) => s.branch_id === branchId && !s.is_voided && inRange(s.created_at, from, to));
    const rows = d.app_users.filter((u) => u.is_active && (u.branch_id === branchId || u.branch_id === null)).map((u) => {
      const uj = released.filter((j) => j.tech_id === u.id);
      const us = sales.filter((s) => s.sold_by === u.id);
      const avg = uj.length ? uj.reduce((a, j) => a + (new Date(j.released_at) - new Date(j.received_at)) / 36e5, 0) / uj.length : 0;
      return { name: u.full_name, role: u.role, jobs: uj.length, avg: Math.round(avg * 10) / 10, svc: uj.reduce((a, j) => a + Number(j.fee), 0), scount: us.length, stotal: us.reduce((a, s) => a + Number(s.total_amount), 0) };
    }).sort((a, b) => b.svc - a.svc);
    return build(
      [{ header: "Staff", key: "name", width: 22 }, { header: "Role", key: "role", width: 14 }, { header: "Repairs completed", key: "jobs", width: 16, number: true }, { header: "Avg turnaround (hrs)", key: "avg", width: 18, number: true }, { header: "Service income", key: "svc", width: 16, money: true }, { header: "Sales count", key: "scount", width: 12, number: true }, { header: "Sales total", key: "stotal", width: 16, money: true }],
      rows, { sheetName: "Technician productivity", title: "Technician Productivity", file: "technician-productivity", totals: { role: "TOTAL", jobs: rows.reduce((a, r) => a + r.jobs, 0), svc: rows.reduce((a, r) => a + r.svc, 0), stotal: rows.reduce((a, r) => a + r.stotal, 0) } }
    );
  }

  if (type === "fund-movement") {
    let bal = 0, totIn = 0, totOut = 0;
    const rows = d.fund_movements.filter((f) => f.branch_id === branchId && inRange(f.created_at, from, to))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((m) => {
        const amt = Number(m.amount); const isIn = m.direction === "in";
        if (isIn) { bal += amt; totIn += amt; } else { bal -= amt; totOut += amt; }
        return { date: fmtDT(m.created_at), dir: isIn ? "IN" : "OUT", cat: m.category, in: isIn ? amt : null, out: isIn ? null : amt, bal, by: uName(m.performed_by), notes: m.notes || "" };
      });
    return build(
      [{ header: "Date", key: "date", width: 20 }, { header: "Direction", key: "dir", width: 12 }, { header: "Category", key: "cat", width: 18 }, { header: "In", key: "in", width: 14, money: true }, { header: "Out", key: "out", width: 14, money: true }, { header: "Balance", key: "bal", width: 14, money: true }, { header: "By", key: "by", width: 18 }, { header: "Notes", key: "notes", width: 30 }],
      rows, { sheetName: "Fund movement", title: "Fund Movement", file: "fund-movement", totals: { cat: "TOTAL", in: totIn, out: totOut, bal } }
    );
  }

  throw new Error("Unknown report type");
}
