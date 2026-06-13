import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";

const router = Router();

// PH business date helper used by all cash math.
const PH = "Asia/Manila";

// Today's expected cash (sum of non-voided cash sales, PH date) + closing history.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows: exp } = await query(
      `SELECT COALESCE(SUM(total_amount),0) AS expected
       FROM sales
       WHERE branch_id = $1 AND is_voided = false AND payment_method = 'cash'
         AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
      [branchId, PH]
    );
    const { rows: history } = await query(
      `SELECT c.*, u.full_name AS closed_by_name
       FROM cash_reconciliations c
       JOIN app_users u ON u.id = c.closed_by
       WHERE c.branch_id = $1
       ORDER BY c.business_date DESC`,
      [branchId]
    );
    const today = (await query(`SELECT (now() AT TIME ZONE $1)::date AS d`, [PH])).rows[0].d;
    const closedToday = history.some((h) => String(h.business_date) === String(today));
    res.json({ expected_cash: Number(exp[0].expected), closed_today: closedToday, today, history });
  })
);

// Close the day. One per branch per business date (DB unique constraint).
router.post(
  "/",
  wrap(async (req, res) => {
    const counted = Number(req.body?.counted_cash);
    if (isNaN(counted)) throw fail(400, "Enter the counted cash amount");
    const branchId = await resolveBranchId(req);
    const { rows: exp } = await query(
      `SELECT COALESCE(SUM(total_amount),0) AS expected
       FROM sales
       WHERE branch_id = $1 AND is_voided = false AND payment_method = 'cash'
         AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
      [branchId, PH]
    );
    try {
      const { rows } = await query(
        `INSERT INTO cash_reconciliations (branch_id, business_date, expected_cash, counted_cash, notes, closed_by)
         VALUES ($1, (now() AT TIME ZONE $2)::date, $3, $4, $5, $6) RETURNING *`,
        [branchId, PH, Number(exp[0].expected), counted, req.body?.notes || null, req.user.sub]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === "23505") throw fail(409, "Today is already closed for this branch");
      throw e;
    }
  })
);

export default router;
