import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail } from "../util.js";
import { requireRole, hashPassword } from "../auth.js";

const router = Router();

// List staff (passwords never returned)
router.get(
  "/",
  wrap(async (req, res) => {
    const { rows } = await query(
      "SELECT id, username, full_name, role, branch_id, phone, is_active, created_at FROM app_users ORDER BY created_at"
    );
    res.json(rows);
  })
);

// Add staff (owner/manager). A username + password makes them a login account.
router.post(
  "/",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { full_name, role = "staff", username, password, branch_id, phone } = req.body || {};
    if (!full_name) throw fail(400, "Name is required");
    if (!username || !password) throw fail(400, "Username and password are required");
    const dupe = await query("SELECT 1 FROM app_users WHERE lower(username) = lower($1)", [username]);
    if (dupe.rowCount) throw fail(409, "That username is already taken");
    const hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO app_users (username, password_hash, full_name, role, branch_id, phone)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, username, full_name, role, branch_id, phone, is_active, created_at`,
      [username, hash, full_name, role, branch_id || null, phone || null]
    );
    res.status(201).json(rows[0]);
  })
);

// Reset a staff password (owner/manager)
router.post(
  "/:id/password",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { password } = req.body || {};
    if (!password || password.length < 4) throw fail(400, "Password too short");
    const hash = await hashPassword(password);
    await query("UPDATE app_users SET password_hash = $2 WHERE id = $1", [req.params.id, hash]);
    res.json({ ok: true });
  })
);

// Deactivate staff (records stay intact). Owner/manager only.
router.delete(
  "/:id",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    if (req.params.id === req.user.sub) throw fail(400, "You can't deactivate your own account");
    await query("UPDATE app_users SET is_active = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  })
);

export default router;
