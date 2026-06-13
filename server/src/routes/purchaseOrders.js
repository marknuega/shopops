import { Router } from "express";
import { query, tx } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";
import { requireRole } from "../auth.js";
import { applyMovement } from "../stock.js";

const router = Router();

// Materials orders for the active branch, with supplier + line items.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `SELECT po.*, s.name AS supplier_name, u.full_name AS created_by_name,
              COALESCE(json_agg(json_build_object(
                'id', i.id, 'product_id', i.product_id, 'name', p.name,
                'qty_ordered', i.qty_ordered, 'qty_received', i.qty_received, 'unit_cost', i.unit_cost
              ) ORDER BY p.name) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN app_users u ON u.id = po.created_by
       LEFT JOIN purchase_order_items i ON i.po_id = po.id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE po.branch_id = $1
       GROUP BY po.id, s.name, u.full_name
       ORDER BY po.created_at DESC`,
      [branchId]
    );
    res.json(rows);
  })
);

// Create a materials order (status 'ordered'). Owner/manager only.
router.post(
  "/",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { supplier_id, items, notes } = req.body || {};
    if (!supplier_id) throw fail(400, "Choose a supplier");
    if (!Array.isArray(items) || items.length === 0) throw fail(400, "Add at least one item");
    const branchId = await resolveBranchId(req);

    const po = await tx(async (c) => {
      let total = 0;
      for (const it of items) {
        const q = parseInt(it.qty_ordered, 10);
        if (!q || q <= 0) throw fail(400, "Invalid order quantity");
        total += Number(it.unit_cost || 0) * q;
      }
      const { rows } = await c.query(
        `INSERT INTO purchase_orders (branch_id, supplier_id, status, total_cost, notes, created_by)
         VALUES ($1,$2,'ordered',$3,$4,$5) RETURNING *`,
        [branchId, supplier_id, total, notes || null, req.user.sub]
      );
      const created = rows[0];
      for (const it of items) {
        await c.query(
          `INSERT INTO purchase_order_items (po_id, product_id, qty_ordered, unit_cost)
           VALUES ($1,$2,$3,$4)`,
          [created.id, it.product_id, parseInt(it.qty_ordered, 10), Number(it.unit_cost || 0)]
        );
      }
      return created;
    });
    res.status(201).json(po);
  })
);

// Receive the whole order: bring all ordered qty into stock (purchase_in), mark received.
router.post(
  "/:id/receive",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    await tx(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM purchase_orders WHERE id = $1 AND branch_id = $2 FOR UPDATE",
        [req.params.id, branchId]
      );
      const po = rows[0];
      if (!po) throw fail(404, "Order not found");
      if (po.status === "received") throw fail(400, "This order is already received");
      if (po.status === "cancelled") throw fail(400, "This order was cancelled");

      const { rows: lines } = await c.query("SELECT * FROM purchase_order_items WHERE po_id = $1", [po.id]);
      for (const line of lines) {
        const outstanding = line.qty_ordered - line.qty_received;
        if (outstanding <= 0) continue;
        await applyMovement(c, {
          branchId,
          productId: line.product_id,
          type: "purchase_in",
          quantity: outstanding,
          referenceId: po.id,
          reason: "Materials order received",
          performedBy: req.user.sub,
        });
        await c.query("UPDATE purchase_order_items SET qty_received = qty_ordered WHERE id = $1", [line.id]);
      }
      await c.query(
        "UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = $1",
        [po.id]
      );
    });
    res.json({ ok: true });
  })
);

// Cancel an unreceived order. Owner/manager only.
router.post(
  "/:id/cancel",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      "UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1 AND branch_id = $2 AND status <> 'received' RETURNING *",
      [req.params.id, branchId]
    );
    if (!rows[0]) throw fail(400, "Can't cancel — order not found or already received");
    res.json({ ok: true });
  })
);

export default router;
