import { Router } from "express";
import { query, tx } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";
import { requireRole } from "../auth.js";
import { applyMovement } from "../stock.js";

const router = Router();

// Inventory for the active branch, joined with product info.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `SELECT p.id AS product_id, p.sku, p.name, p.brand, p.image, p.cost_price, p.selling_price, p.warranty_days,
              c.name AS category,
              COALESCE(bi.quantity, 0) AS quantity,
              COALESCE(bi.min_stock, 3) AS min_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $1
       WHERE p.is_active = true
       ORDER BY p.name`,
      [branchId]
    );
    res.json(rows);
  })
);

// Receive stock from a supplier (purchase_in). Owner/manager only.
router.post(
  "/:productId/restock",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const qty = parseInt(req.body?.quantity, 10);
    if (!qty || qty <= 0) throw fail(400, "Enter a positive quantity");
    const branchId = await resolveBranchId(req);
    const newQty = await tx((c) =>
      applyMovement(c, {
        branchId,
        productId: req.params.productId,
        type: "purchase_in",
        quantity: qty,
        reason: req.body?.reason || "Supplier delivery",
        performedBy: req.user.sub,
      })
    );
    res.json({ ok: true, quantity: newQty });
  })
);

// Manual adjustment (requires reason — schema rule #2). Owner/manager only.
router.post(
  "/:productId/adjust",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const delta = parseInt(req.body?.delta, 10);
    const reason = (req.body?.reason || "").trim();
    if (!delta) throw fail(400, "Enter a non-zero adjustment (e.g. +10 or -2)");
    if (!reason) throw fail(400, "A reason is required for stock adjustments");
    const branchId = await resolveBranchId(req);
    try {
      const newQty = await tx((c) =>
        applyMovement(c, {
          branchId,
          productId: req.params.productId,
          type: "adjustment",
          quantity: delta,
          reason,
          performedBy: req.user.sub,
        })
      );
      res.json({ ok: true, quantity: newQty });
    } catch (e) {
      if (e.constraint === "non_negative_stock") throw fail(400, "That would put stock below zero");
      throw e;
    }
  })
);

// Set the low-stock threshold. Owner/manager only.
router.post(
  "/:productId/min-stock",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const min = parseInt(req.body?.min_stock, 10);
    if (isNaN(min) || min < 0) throw fail(400, "Invalid minimum");
    const branchId = await resolveBranchId(req);
    await query(
      `INSERT INTO branch_inventory (branch_id, product_id, min_stock)
       VALUES ($1,$2,$3)
       ON CONFLICT (branch_id, product_id) DO UPDATE SET min_stock = EXCLUDED.min_stock`,
      [branchId, req.params.productId, min]
    );
    res.json({ ok: true });
  })
);

export default router;
