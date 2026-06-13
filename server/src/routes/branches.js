import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail } from "../util.js";
import { requireRole } from "../auth.js";

const router = Router();

router.get(
  "/",
  wrap(async (req, res) => {
    const { rows } = await query("SELECT * FROM branches ORDER BY created_at");
    res.json(rows);
  })
);

// Create a new branch / location (owner only).
router.post(
  "/",
  requireRole("owner"),
  wrap(async (req, res) => {
    const { name, address, city, phone } = req.body || {};
    if (!name || !name.trim()) throw fail(400, "Branch name is required");
    const { rows } = await query(
      `INSERT INTO branches (name, address, city, phone)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), address || null, city || null, phone || null]
    );
    res.status(201).json(rows[0]);
  })
);

// Update shop/branch details (owner/manager)
router.patch(
  "/:id",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { name, address, city, phone } = req.body || {};
    const { rows } = await query(
      `UPDATE branches SET
         name = COALESCE($2, name),
         address = COALESCE($3, address),
         city = COALESCE($4, city),
         phone = COALESCE($5, phone)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, address, city, phone]
    );
    res.json(rows[0]);
  })
);

export default router;
