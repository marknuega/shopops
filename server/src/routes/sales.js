import { Router } from "express";
import { query, tx } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";
import { applyMovement } from "../stock.js";

const router = Router();

// Recent sales with their items + who sold them.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const { rows } = await query(
      `SELECT s.*, u.full_name AS sold_by_name,
              COALESCE(json_agg(json_build_object(
                'product_id', si.product_id, 'name', p.name,
                'quantity', si.quantity, 'unit_price', si.unit_price,
                'warranty_days', si.warranty_days
              ) ORDER BY p.name) FILTER (WHERE si.id IS NOT NULL), '[]') AS items
       FROM sales s
       JOIN app_users u ON u.id = s.sold_by
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.branch_id = $1
       GROUP BY s.id, u.full_name
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [branchId, limit]
    );
    res.json(rows);
  })
);

// Record a sale: insert sale + items, snapshot price/cost, decrement stock via movements.
router.post(
  "/",
  wrap(async (req, res) => {
    const { items, payment_method = "cash" } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) throw fail(400, "Cart is empty");
    const branchId = await resolveBranchId(req);

    const sale = await tx(async (c) => {
      // load product cost/price + current stock, locked
      const ids = items.map((i) => i.product_id);
      const { rows: prods } = await c.query(
        `SELECT p.id, p.selling_price, p.cost_price, p.warranty_days, COALESCE(bi.quantity,0) AS qty
         FROM products p
         LEFT JOIN branch_inventory bi ON bi.product_id = p.id AND bi.branch_id = $2
         WHERE p.id = ANY($1) FOR UPDATE OF p`,
        [ids, branchId]
      );
      const byId = Object.fromEntries(prods.map((p) => [p.id, p]));

      let total = 0;
      for (const it of items) {
        const p = byId[it.product_id];
        if (!p) throw fail(400, "A product in the cart no longer exists");
        const q = parseInt(it.quantity, 10);
        if (!q || q <= 0) throw fail(400, "Invalid quantity");
        if (q > p.qty) throw fail(400, "Not enough stock for one of the items");
        total += Number(p.selling_price) * q;
      }

      const { rows: saleRows } = await c.query(
        `INSERT INTO sales (branch_id, total_amount, payment_method, sold_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [branchId, total, payment_method, req.user.sub]
      );
      const created = saleRows[0];

      for (const it of items) {
        const p = byId[it.product_id];
        const q = parseInt(it.quantity, 10);
        await c.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, warranty_days)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created.id, it.product_id, q, p.selling_price, p.cost_price, p.warranty_days || 0]
        );
        await applyMovement(c, {
          branchId,
          productId: it.product_id,
          type: "sale",
          quantity: -q,
          referenceId: created.id,
          performedBy: req.user.sub,
        });
      }
      return created;
    });

    res.status(201).json(sale);
  })
);

// Void a sale (requires reason — schema rule #2). Returns stock to inventory.
router.post(
  "/:id/void",
  wrap(async (req, res) => {
    const reason = (req.body?.reason || "").trim();
    if (!reason) throw fail(400, "A reason is required to void a sale");
    const branchId = await resolveBranchId(req);

    await tx(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM sales WHERE id = $1 AND branch_id = $2 FOR UPDATE",
        [req.params.id, branchId]
      );
      const sale = rows[0];
      if (!sale) throw fail(404, "Sale not found");
      if (sale.is_voided) throw fail(400, "This sale is already voided");

      const { rows: lines } = await c.query("SELECT * FROM sale_items WHERE sale_id = $1", [sale.id]);
      for (const line of lines) {
        await applyMovement(c, {
          branchId,
          productId: line.product_id,
          type: "return_in",
          quantity: line.quantity, // put stock back
          referenceId: sale.id,
          reason: "Void: " + reason,
          performedBy: req.user.sub,
        });
      }
      await c.query(
        "UPDATE sales SET is_voided = true, void_reason = $2, voided_by = $3 WHERE id = $1",
        [sale.id, reason, req.user.sub]
      );
    });

    res.json({ ok: true });
  })
);

export default router;
