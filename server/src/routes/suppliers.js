import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail } from "../util.js";

const router = Router();

router.get(
  "/",
  wrap(async (req, res) => {
    const { rows } = await query("SELECT * FROM suppliers WHERE is_active = true ORDER BY name");
    res.json(rows);
  })
);

router.post(
  "/",
  wrap(async (req, res) => {
    const { name, contact, phone, notes } = req.body || {};
    if (!name) throw fail(400, "Supplier name is required");
    const { rows } = await query(
      "INSERT INTO suppliers (name, contact, phone, notes) VALUES ($1,$2,$3,$4) RETURNING *",
      [name, contact || null, phone || null, notes || null]
    );
    res.status(201).json(rows[0]);
  })
);

export default router;
