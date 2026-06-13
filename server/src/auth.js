import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { query } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-insecure-secret";
const TOKEN_TTL = "30d"; // long-lived: shop staff stay logged in on the till

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, branch_id: user.branch_id },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export async function login(username, password) {
  const { rows } = await query(
    "SELECT * FROM app_users WHERE lower(username) = lower($1) AND is_active = true",
    [username]
  );
  const user = rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return user;
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

// Roles that may view everything but change nothing (investor / partner view).
const READ_ONLY_ROLES = new Set(["partner"]);

// Middleware: require a valid bearer token. Also enforces that read-only roles
// (e.g. partner) can only issue safe GET requests — every write is refused here,
// so individual routes don't each have to remember to exclude them.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: "Session expired — please log in again" });
  }
  if (READ_ONLY_ROLES.has(req.user.role) && req.method !== "GET") {
    return res.status(403).json({ error: "Your account has view-only access." });
  }
  next();
}

// Middleware factory: require one of the given roles.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission for this action" });
    }
    next();
  };
}

export function publicUser(u) {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, branch_id: u.branch_id };
}
