import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";

const router = Router();

const DIRECTIONS = ["in", "out"];
const CATEGORIES = ["capital", "owner_withdrawal", "expense", "bank_deposit", "cash_sale", "refund", "other"];

// Fund movements (cash in/out of the business) + a running balance + totals.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `SELECT f.*, u.full_name AS performed_by_name
       FROM fund_movements f
       JOIN app_users u ON u.id = f.performed_by
       WHERE f.branch_id = $1
       ORDER BY f.created_at DESC`,
      [branchId]
    );
    const totals = rows.reduce(
      (a, r) => {
        if (r.direction === "in") a.in += Number(r.amount);
        else a.out += Number(r.amount);
        return a;
      },
      { in: 0, out: 0 }
    );
    res.json({ movements: rows, totals: { ...totals, balance: totals.in - totals.out } });
  })
);

// Record cash moving in or out.
router.post(
  "/",
  wrap(async (req, res) => {
    const { direction, category = "other", amount, notes } = req.body || {};
    if (!DIRECTIONS.includes(direction)) throw fail(400, "Direction must be 'in' or 'out'");
    if (!CATEGORIES.includes(category)) throw fail(400, "Invalid category");
    const amt = Number(amount);
    if (!amt || amt <= 0) throw fail(400, "Enter a positive amount");
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `INSERT INTO fund_movements (branch_id, direction, category, amount, notes, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [branchId, direction, category, amt, notes || null, req.user.sub]
    );
    res.status(201).json(rows[0]);
  })
);

export default router;
