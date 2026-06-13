import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail } from "../util.js";
import { requireRole } from "../auth.js";

const router = Router();

// List products with category name.
router.get(
  "/",
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT p.*, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = true
       ORDER BY p.name`
    );
    res.json(rows);
  })
);

router.get(
  "/categories",
  wrap(async (req, res) => {
    const { rows } = await query("SELECT * FROM categories ORDER BY name");
    res.json(rows);
  })
);

// Create a product. Owner/manager only. Also creates a branch_inventory row.
router.post(
  "/",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { sku, name, category, brand, image, cost_price = 0, selling_price = 0, warranty_days = 0, qty = 0, min_stock = 3, branch_id } =
      req.body || {};
    if (!sku || !name) throw fail(400, "SKU and product name are required");

    const dupe = await query("SELECT 1 FROM products WHERE lower(sku) = lower($1)", [sku]);
    if (dupe.rowCount) throw fail(409, "A product with that SKU already exists");

    // resolve / create category
    let categoryId = null;
    if (category) {
      const cat = await query(
        `INSERT INTO categories (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [category]
      );
      categoryId = cat.rows[0].id;
    }

    const branch =
      branch_id || (await query("SELECT id FROM branches ORDER BY created_at LIMIT 1")).rows[0]?.id;

    const { rows } = await query(
      `INSERT INTO products (sku, name, category_id, brand, image, cost_price, selling_price, warranty_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [sku, name, categoryId, brand || null, image || null, cost_price, selling_price, parseInt(warranty_days, 10) || 0]
    );
    const product = rows[0];

    if (branch) {
      await query(
        `INSERT INTO branch_inventory (branch_id, product_id, quantity, min_stock)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, min_stock = EXCLUDED.min_stock`,
        [branch, product.id, qty, min_stock]
      );
    }
    res.status(201).json(product);
  })
);

// Update product details/prices. Owner/manager only.
router.patch(
  "/:id",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    const { name, cost_price, selling_price, brand, image, warranty_days } = req.body || {};
    const { rows } = await query(
      `UPDATE products SET
        name = COALESCE($2, name),
        cost_price = COALESCE($3, cost_price),
        selling_price = COALESCE($4, selling_price),
        brand = COALESCE($5, brand),
        image = COALESCE($6, image),
        warranty_days = COALESCE($7, warranty_days)
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, cost_price, selling_price, brand, image,
       warranty_days === undefined ? null : parseInt(warranty_days, 10) || 0]
    );
    res.json(rows[0]);
  })
);

// Soft-delete (deactivate) a product. Owner/manager only.
router.delete(
  "/:id",
  requireRole("owner", "manager"),
  wrap(async (req, res) => {
    await query("UPDATE products SET is_active = false WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  })
);

export default router;
