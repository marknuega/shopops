import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, signToken, publicUser, requireAuth } from "../auth.js";
import { query } from "../db.js";
import { wrap } from "../util.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 attempts / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

router.post(
  "/login",
  loginLimiter,
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Username and password are required" });
    const user = await login(username, password);
    if (!user) return res.status(401).json({ error: "Wrong username or password" });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const { rows } = await query("SELECT * FROM app_users WHERE id = $1", [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: publicUser(rows[0]) });
  })
);

export default router;
