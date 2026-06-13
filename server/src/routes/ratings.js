import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";

const router = Router();

router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      "SELECT * FROM ratings WHERE branch_id = $1 ORDER BY created_at DESC",
      [branchId]
    );
    const count = rows.length;
    const avg = count ? rows.reduce((a, r) => a + r.stars, 0) / count : null;
    res.json({ ratings: rows, count, average: avg ? Number(avg.toFixed(1)) : null });
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const stars = parseInt(req.body?.stars, 10);
    if (!(stars >= 1 && stars <= 5)) throw fail(400, "Stars must be 1–5");
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `INSERT INTO ratings (branch_id, stars, customer_name, comment)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [branchId, stars, req.body?.customer_name || null, req.body?.comment || null]
    );
    res.status(201).json(rows[0]);
  })
);

export default router;
