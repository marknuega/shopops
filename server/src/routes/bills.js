import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";

const router = Router();

router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      "SELECT * FROM bills WHERE branch_id = $1 ORDER BY is_paid, COALESCE(due_date, created_at::date) , created_at DESC",
      [branchId]
    );
    res.json(rows);
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const { name, category = "Utilities", amount, due_date } = req.body || {};
    if (!name || !amount) throw fail(400, "Bill name and amount are required");
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `INSERT INTO bills (branch_id, name, category, amount, due_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [branchId, name, category, Number(amount), due_date || null]
    );
    res.status(201).json(rows[0]);
  })
);

// Toggle paid/unpaid.
router.patch(
  "/:id/paid",
  wrap(async (req, res) => {
    const paid = !!req.body?.paid;
    const { rows } = await query(
      "UPDATE bills SET is_paid = $2, paid_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING *",
      [req.params.id, paid]
    );
    if (!rows[0]) throw fail(404, "Bill not found");
    res.json(rows[0]);
  })
);

export default router;
