import { query } from "./db.js";

// Resolve the branch a request operates on.
// Staff/manager are pinned to their branch; the owner (branch_id NULL) may pass
// ?branch=<id>, otherwise we fall back to the first branch (single-shop default).
export async function resolveBranchId(req) {
  if (req.user?.branch_id) return req.user.branch_id;
  const requested = req.query.branch || req.body?.branch_id;
  if (requested) return requested;
  const { rows } = await query("SELECT id FROM branches ORDER BY created_at LIMIT 1");
  return rows[0]?.id || null;
}

// Wrap an async route handler so thrown errors become a clean 500 (or the
// status the handler set) instead of crashing the process.
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(`[${req.method} ${req.originalUrl}]`, err.message);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.publicMessage || "Server error" });
  });

// Throw a request error with an HTTP status + user-facing message.
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}
