import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";
import { buildWorkbook, fmtDT, fmtDate } from "../reports/excel.js";

const router = Router();
const PH = "Asia/Manila";

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (PH dates, inclusive). Returns SQL
// fragment + params appended after the branch param ($1).
function dateRange(req, col, startIdx) {
  const params = [];
  let sql = "";
  if (req.query.from) {
    params.push(req.query.from);
    sql += ` AND (${col} AT TIME ZONE '${PH}')::date >= $${startIdx + params.length}`;
  }
  if (req.query.to) {
    params.push(req.query.to);
    sql += ` AND (${col} AT TIME ZONE '${PH}')::date <= $${startIdx + params.length}`;
  }
  return { sql, params };
}

async function send(res, wb, filename) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

const stamp = () => fmtDate(Date.now());

router.get(
  "/:type.xlsx",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const type = req.params.type;

    // ---------- 1. REPAIR LOGS ----------
    if (type === "repair-logs") {
      const dr = dateRange(req, "j.received_at", 1);
      const { rows } = await query(
        `SELECT j.*, u.full_name AS tech_name
         FROM service_jobs j LEFT JOIN app_users u ON u.id = j.tech_id
         WHERE j.branch_id=$1 ${dr.sql} ORDER BY j.received_at DESC`,
        [branchId, ...dr.params]
      );
      const cols = [
        { header: "Received", key: "received", width: 20 },
        { header: "Customer", key: "customer", width: 20 },
        { header: "Contact", key: "phone", width: 16 },
        { header: "Device", key: "device", width: 24 },
        { header: "Issue", key: "issue", width: 30 },
        { header: "Technician", key: "tech", width: 18 },
        { header: "Fee", key: "fee", width: 12, money: true },
        { header: "Status", key: "status", width: 16 },
        { header: "Released", key: "released", width: 20 },
      ];
      const data = rows.map((j) => ({
        received: fmtDT(j.received_at), customer: j.customer, phone: j.phone || "",
        device: j.device, issue: j.issue || "", tech: j.tech_name || "Unassigned",
        fee: Number(j.fee), status: j.status, released: fmtDT(j.released_at),
      }));
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Repair logs", title: "Repair / Service Logsheet",
        totals: { device: `${data.length} jobs`, fee: data.reduce((a, d) => a + d.fee, 0) },
      });
      return send(res, wb, `repair-logs_${stamp()}.xlsx`);
    }

    // ---------- 2. SALES ----------
    if (type === "sales") {
      const dr = dateRange(req, "s.created_at", 1);
      const { rows } = await query(
        `SELECT s.sale_number, s.created_at, s.payment_method, s.is_voided, s.void_reason,
                u.full_name AS sold_by, p.name AS product, si.quantity, si.unit_price
         FROM sales s
         JOIN app_users u ON u.id = s.sold_by
         LEFT JOIN sale_items si ON si.sale_id = s.id
         LEFT JOIN products p ON p.id = si.product_id
         WHERE s.branch_id=$1 ${dr.sql}
         ORDER BY s.created_at DESC, s.sale_number`,
        [branchId, ...dr.params]
      );
      const cols = [
        { header: "Receipt #", key: "no", width: 12, number: true },
        { header: "Date", key: "date", width: 20 },
        { header: "Item", key: "item", width: 28 },
        { header: "Qty", key: "qty", width: 8, number: true },
        { header: "Unit price", key: "price", width: 14, money: true },
        { header: "Line total", key: "line", width: 14, money: true },
        { header: "Payment", key: "method", width: 12 },
        { header: "Sold by", key: "soldby", width: 18 },
        { header: "Voided", key: "voided", width: 22 },
      ];
      let grand = 0;
      const data = rows.map((r) => {
        const line = r.is_voided ? 0 : Number(r.unit_price || 0) * (r.quantity || 0);
        grand += line;
        return {
          no: Number(r.sale_number), date: fmtDT(r.created_at), item: r.product || "—",
          qty: r.quantity || 0, price: Number(r.unit_price || 0), line,
          method: r.payment_method, soldby: r.sold_by,
          voided: r.is_voided ? `VOIDED — ${r.void_reason || ""}` : "",
        };
      });
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Sales", title: "Sales Report",
        totals: { item: `${data.length} line items`, line: grand },
      });
      return send(res, wb, `sales_${stamp()}.xlsx`);
    }

    // ---------- 3. MATERIALS ORDERS ----------
    if (type === "materials-orders") {
      const dr = dateRange(req, "po.created_at", 1);
      const { rows } = await query(
        `SELECT po.po_number, po.created_at, po.status, po.received_at, s.name AS supplier,
                p.name AS product, i.qty_ordered, i.qty_received, i.unit_cost
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN purchase_order_items i ON i.po_id = po.id
         LEFT JOIN products p ON p.id = i.product_id
         WHERE po.branch_id=$1 ${dr.sql}
         ORDER BY po.created_at DESC, po.po_number`,
        [branchId, ...dr.params]
      );
      const cols = [
        { header: "PO #", key: "no", width: 10, number: true },
        { header: "Ordered", key: "date", width: 20 },
        { header: "Supplier", key: "supplier", width: 22 },
        { header: "Product", key: "product", width: 28 },
        { header: "Qty ordered", key: "ord", width: 12, number: true },
        { header: "Qty received", key: "rec", width: 12, number: true },
        { header: "Unit cost", key: "cost", width: 14, money: true },
        { header: "Line cost", key: "line", width: 14, money: true },
        { header: "Status", key: "status", width: 16 },
        { header: "Received", key: "recv", width: 20 },
      ];
      let grand = 0;
      const data = rows.map((r) => {
        const line = Number(r.unit_cost || 0) * (r.qty_ordered || 0);
        grand += line;
        return {
          no: Number(r.po_number), date: fmtDT(r.created_at), supplier: r.supplier,
          product: r.product || "—", ord: r.qty_ordered || 0, rec: r.qty_received || 0,
          cost: Number(r.unit_cost || 0), line, status: r.status, recv: fmtDT(r.received_at),
        };
      });
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Materials orders", title: "Materials Orders (Purchase Orders)",
        totals: { product: `${data.length} lines`, line: grand },
      });
      return send(res, wb, `materials-orders_${stamp()}.xlsx`);
    }

    // ---------- 4. BACKLOGS (everything outstanding) ----------
    if (type === "backlogs") {
      const jobs = await query(
        `SELECT j.received_at AS dt, j.customer, j.device, j.status, j.fee, u.full_name AS owner
         FROM service_jobs j LEFT JOIN app_users u ON u.id=j.tech_id
         WHERE j.branch_id=$1 AND j.status <> 'released'`,
        [branchId]
      );
      const pos = await query(
        `SELECT po.created_at AS dt, po.po_number, s.name AS supplier, po.status, po.total_cost,
                u.full_name AS owner
         FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
         JOIN app_users u ON u.id=po.created_by
         WHERE po.branch_id=$1 AND po.status NOT IN ('received','cancelled')`,
        [branchId]
      );
      const billsR = await query(
        `SELECT created_at AS dt, name, category, amount, due_date
         FROM bills WHERE branch_id=$1 AND is_paid=false`,
        [branchId]
      );
      const cols = [
        { header: "Type", key: "type", width: 18 },
        { header: "Since", key: "since", width: 20 },
        { header: "Age (days)", key: "age", width: 12, number: true },
        { header: "Reference", key: "ref", width: 26 },
        { header: "Description", key: "desc", width: 30 },
        { header: "Amount", key: "amount", width: 14, money: true },
        { header: "Owner / note", key: "owner", width: 22 },
      ];
      const ageDays = (dt) => Math.floor((Date.now() - new Date(dt).getTime()) / 864e5);
      const data = [
        ...jobs.rows.map((r) => ({
          type: "Open repair", since: fmtDT(r.dt), age: ageDays(r.dt), ref: r.customer,
          desc: `${r.device} — ${r.status}`, amount: Number(r.fee), owner: r.owner || "Unassigned",
        })),
        ...pos.rows.map((r) => ({
          type: "Pending order", since: fmtDT(r.dt), age: ageDays(r.dt), ref: `PO #${r.po_number}`,
          desc: `${r.supplier} — ${r.status}`, amount: Number(r.total_cost || 0), owner: r.owner,
        })),
        ...billsR.rows.map((r) => ({
          type: "Unpaid bill", since: fmtDT(r.dt), age: ageDays(r.dt), ref: r.name,
          desc: `${r.category}${r.due_date ? " — due " + fmtDate(r.due_date) : ""}`,
          amount: Number(r.amount), owner: "",
        })),
      ].sort((a, b) => b.age - a.age);
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Backlogs", title: "Backlog — Outstanding Work",
        totals: { desc: `${data.length} open items`, amount: data.reduce((a, d) => a + d.amount, 0) },
      });
      return send(res, wb, `backlogs_${stamp()}.xlsx`);
    }

    // ---------- 5. TECHNICIAN PRODUCTIVITY ----------
    if (type === "technician-productivity") {
      const dr = dateRange(req, "j.released_at", 1);
      const sdr = dateRange(req, "s.created_at", 1 + dr.params.length);
      const { rows } = await query(
        `SELECT u.full_name, u.role,
           (SELECT COUNT(*) FROM service_jobs j
             WHERE j.tech_id=u.id AND j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL ${dr.sql}) AS jobs_done,
           (SELECT COALESCE(SUM(fee),0) FROM service_jobs j
             WHERE j.tech_id=u.id AND j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL ${dr.sql}) AS service_income,
           (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (j.released_at - j.received_at))/3600.0),0) FROM service_jobs j
             WHERE j.tech_id=u.id AND j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL ${dr.sql}) AS avg_hours,
           (SELECT COUNT(*) FROM sales s
             WHERE s.sold_by=u.id AND s.branch_id=$1 AND s.is_voided=false ${sdr.sql}) AS sales_count,
           (SELECT COALESCE(SUM(s.total_amount),0) FROM sales s
             WHERE s.sold_by=u.id AND s.branch_id=$1 AND s.is_voided=false ${sdr.sql}) AS sales_total
         FROM app_users u
         WHERE u.is_active=true AND (u.branch_id=$1 OR u.branch_id IS NULL)
         ORDER BY service_income DESC`,
        [branchId, ...dr.params, ...sdr.params]
      );
      const cols = [
        { header: "Staff", key: "name", width: 22 },
        { header: "Role", key: "role", width: 14 },
        { header: "Repairs completed", key: "jobs", width: 16, number: true },
        { header: "Avg turnaround (hrs)", key: "avg", width: 18, number: true },
        { header: "Service income", key: "svc", width: 16, money: true },
        { header: "Sales count", key: "scount", width: 12, number: true },
        { header: "Sales total", key: "stotal", width: 16, money: true },
      ];
      const data = rows.map((r) => ({
        name: r.full_name, role: r.role, jobs: Number(r.jobs_done),
        avg: Math.round(Number(r.avg_hours) * 10) / 10, svc: Number(r.service_income),
        scount: Number(r.sales_count), stotal: Number(r.sales_total),
      }));
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Technician productivity", title: "Technician Productivity",
        totals: {
          role: "TOTAL", jobs: data.reduce((a, d) => a + d.jobs, 0),
          svc: data.reduce((a, d) => a + d.svc, 0), stotal: data.reduce((a, d) => a + d.stotal, 0),
        },
      });
      return send(res, wb, `technician-productivity_${stamp()}.xlsx`);
    }

    // ---------- 6. FUND MOVEMENT ----------
    if (type === "fund-movement") {
      const dr = dateRange(req, "f.created_at", 1);
      const { rows } = await query(
        `SELECT f.created_at, f.direction, f.category, f.amount, f.notes, u.full_name AS by_user
         FROM fund_movements f JOIN app_users u ON u.id=f.performed_by
         WHERE f.branch_id=$1 ${dr.sql} ORDER BY f.created_at ASC`,
        [branchId, ...dr.params]
      );
      const cols = [
        { header: "Date", key: "date", width: 20 },
        { header: "Direction", key: "dir", width: 12 },
        { header: "Category", key: "cat", width: 18 },
        { header: "In", key: "in", width: 14, money: true },
        { header: "Out", key: "out", width: 14, money: true },
        { header: "Balance", key: "bal", width: 14, money: true },
        { header: "By", key: "by", width: 18 },
        { header: "Notes", key: "notes", width: 30 },
      ];
      let bal = 0, totIn = 0, totOut = 0;
      const data = rows.map((r) => {
        const amt = Number(r.amount);
        const isIn = r.direction === "in";
        if (isIn) { bal += amt; totIn += amt; } else { bal -= amt; totOut += amt; }
        return {
          date: fmtDT(r.created_at), dir: isIn ? "IN" : "OUT", cat: r.category,
          in: isIn ? amt : null, out: isIn ? null : amt, bal, by: r.by_user, notes: r.notes || "",
        };
      });
      const wb = await buildWorkbook(cols, data, {
        sheetName: "Fund movement", title: "Fund Movement",
        totals: { cat: "TOTAL", in: totIn, out: totOut, bal },
      });
      return send(res, wb, `fund-movement_${stamp()}.xlsx`);
    }

    throw fail(404, "Unknown report type");
  })
);

export default router;
