import { Router } from "express";
import { query } from "../db.js";
import { wrap, resolveBranchId } from "../util.js";

const router = Router();
const PH = "Asia/Manila";

// Overview tiles + low stock + unpaid bills + red flags.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);

    const today = await query(
      `SELECT
         COALESCE(SUM(total_amount),0) AS total,
         COALESCE(SUM(total_amount) FILTER (WHERE payment_method='cash'),0) AS cash,
         COUNT(*) AS txns
       FROM sales
       WHERE branch_id=$1 AND is_voided=false
         AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
      [branchId, PH]
    );

    const lowStock = await query(
      "SELECT product, sku, quantity, min_stock FROM v_low_stock WHERE branch_id=$1 ORDER BY quantity",
      [branchId]
    );
    const openJobs = await query(
      "SELECT COUNT(*) AS n FROM service_jobs WHERE branch_id=$1 AND status <> 'released'",
      [branchId]
    );
    const unpaidBills = await query(
      "SELECT id, name, amount FROM bills WHERE branch_id=$1 AND is_paid=false ORDER BY COALESCE(due_date, created_at::date)",
      [branchId]
    );
    const redFlags = await query(
      "SELECT flag_type, created_at, by_user, amount, detail FROM v_red_flags WHERE branch_id=$1 ORDER BY created_at DESC",
      [branchId]
    );
    const rating = await query(
      "SELECT ROUND(AVG(stars)::numeric,1) AS avg, COUNT(*) AS n FROM ratings WHERE branch_id=$1",
      [branchId]
    );
    const closed = await query(
      `SELECT 1 FROM cash_reconciliations
       WHERE branch_id=$1 AND business_date = (now() AT TIME ZONE $2)::date`,
      [branchId, PH]
    );

    res.json({
      today: {
        total: Number(today.rows[0].total),
        cash: Number(today.rows[0].cash),
        transactions: Number(today.rows[0].txns),
      },
      low_stock: lowStock.rows,
      open_jobs: Number(openJobs.rows[0].n),
      unpaid_bills: unpaidBills.rows,
      red_flags: redFlags.rows,
      avg_rating: rating.rows[0].avg ? Number(rating.rows[0].avg) : null,
      rating_count: Number(rating.rows[0].n),
      closed_today: closed.rowCount > 0,
    });
  })
);

// This-month P&L + per-staff productivity (current calendar month, PH).
router.get(
  "/performance",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const monthFilter = `date_trunc('month', $COL AT TIME ZONE '${PH}') = date_trunc('month', now() AT TIME ZONE '${PH}')`;

    const pl = await query(
      `WITH ms AS (
         SELECT s.id, s.total_amount
         FROM sales s
         WHERE s.branch_id=$1 AND s.is_voided=false
           AND ${monthFilter.replace("$COL", "s.created_at")}
       )
       SELECT
         (SELECT COALESCE(SUM(total_amount),0) FROM ms) AS revenue,
         (SELECT COALESCE(SUM(si.unit_cost*si.quantity),0)
            FROM sale_items si WHERE si.sale_id IN (SELECT id FROM ms)) AS cogs,
         (SELECT COALESCE(SUM(fee),0) FROM service_jobs j
            WHERE j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL
              AND ${monthFilter.replace("$COL", "j.released_at")}) AS service_income,
         (SELECT COALESCE(SUM(amount),0) FROM bills b
            WHERE b.branch_id=$1 AND b.is_paid=true AND b.paid_at IS NOT NULL
              AND ${monthFilter.replace("$COL", "b.paid_at")}) AS bills_paid`,
      [branchId]
    );

    const staff = await query(
      `SELECT u.id, u.full_name, u.role,
         (SELECT COALESCE(SUM(s.total_amount),0) FROM sales s
            WHERE s.sold_by=u.id AND s.branch_id=$1 AND s.is_voided=false
              AND ${monthFilter.replace("$COL", "s.created_at")}) AS sales_total,
         (SELECT COUNT(*) FROM sales s
            WHERE s.sold_by=u.id AND s.branch_id=$1 AND s.is_voided=false
              AND ${monthFilter.replace("$COL", "s.created_at")}) AS sales_count,
         (SELECT COUNT(*) FROM service_jobs j
            WHERE j.tech_id=u.id AND j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL
              AND ${monthFilter.replace("$COL", "j.released_at")}) AS jobs_done,
         (SELECT COALESCE(SUM(fee),0) FROM service_jobs j
            WHERE j.tech_id=u.id AND j.branch_id=$1 AND j.status='released' AND j.released_at IS NOT NULL
              AND ${monthFilter.replace("$COL", "j.released_at")}) AS service_income
       FROM app_users u
       WHERE u.is_active = true AND (u.branch_id = $1 OR u.branch_id IS NULL)
       ORDER BY sales_total DESC`,
      [branchId]
    );

    const r = pl.rows[0];
    const revenue = Number(r.revenue),
      cogs = Number(r.cogs),
      service_income = Number(r.service_income),
      bills_paid = Number(r.bills_paid);
    res.json({
      pl: { revenue, cogs, service_income, bills_paid, profit: revenue - cogs + service_income - bills_paid },
      staff: staff.rows.map((s) => ({
        ...s,
        sales_total: Number(s.sales_total),
        sales_count: Number(s.sales_count),
        jobs_done: Number(s.jobs_done),
        service_income: Number(s.service_income),
      })),
    });
  })
);

export default router;
