// Single chokepoint for stock changes: write a stock_movements row AND adjust
// branch_inventory in the same transaction. Schema rule #1: stock NEVER changes
// except through here. Always call inside a tx() with the given client.
export async function applyMovement(client, { branchId, productId, type, quantity, referenceId = null, reason = null, performedBy }) {
  await client.query(
    `INSERT INTO stock_movements (branch_id, product_id, movement_type, quantity, reference_id, reason, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [branchId, productId, type, quantity, referenceId, reason, performedBy]
  );
  // upsert inventory; quantity delta = signed movement quantity
  const { rows } = await client.query(
    `INSERT INTO branch_inventory (branch_id, product_id, quantity, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (branch_id, product_id)
       DO UPDATE SET quantity = branch_inventory.quantity + EXCLUDED.quantity, updated_at = now()
     RETURNING quantity`,
    [branchId, productId, quantity]
  );
  return rows[0].quantity; // CHECK (quantity >= 0) will throw if it would go negative
}
