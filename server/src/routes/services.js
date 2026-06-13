import { Router } from "express";
import { query } from "../db.js";
import { wrap, fail, resolveBranchId } from "../util.js";

const router = Router();

// Repair / service jobs for the active branch.
router.get(
  "/",
  wrap(async (req, res) => {
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `SELECT j.*, u.full_name AS tech_name
       FROM service_jobs j
       LEFT JOIN app_users u ON u.id = j.tech_id
       WHERE j.branch_id = $1
       ORDER BY j.received_at DESC`,
      [branchId]
    );
    res.json(rows);
  })
);

// Log a new repair job.
router.post(
  "/",
  wrap(async (req, res) => {
    const { customer, phone, device, model_number, serial_code, issue, fee = 0, tech_id, images,
            customer_details, tech_notes, notes, remarks, instructions, warranty_days = 0 } = req.body || {};
    if (!customer || !device) throw fail(400, "Customer and device are required");
    const branchId = await resolveBranchId(req);
    const { rows } = await query(
      `INSERT INTO service_jobs
         (branch_id, customer, phone, device, model_number, serial_code, issue, fee, tech_id, images,
          customer_details, tech_notes, notes, remarks, instructions, warranty_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [branchId, customer, phone || null, device, model_number || null, serial_code || null, issue || null,
       Number(fee) || 0, tech_id || null,
       JSON.stringify(Array.isArray(images) ? images : []),
       customer_details || null, tech_notes || null, notes || null, remarks || null, instructions || null,
       parseInt(warranty_days, 10) || 0]
    );
    res.status(201).json(rows[0]);
  })
);

// Update the free-text details on a job (technician findings, remarks, etc.).
router.patch(
  "/:id/details",
  wrap(async (req, res) => {
    const { model_number, serial_code, issue, customer_details, tech_notes, notes, remarks, instructions, warranty_days } = req.body || {};
    const { rows } = await query(
      `UPDATE service_jobs SET
         model_number     = COALESCE($2, model_number),
         serial_code      = COALESCE($3, serial_code),
         issue            = COALESCE($4, issue),
         customer_details = COALESCE($5, customer_details),
         tech_notes       = COALESCE($6, tech_notes),
         notes            = COALESCE($7, notes),
         remarks          = COALESCE($8, remarks),
         instructions     = COALESCE($9, instructions),
         warranty_days    = COALESCE($10, warranty_days)
       WHERE id = $1 RETURNING *`,
      [req.params.id, model_number ?? null, serial_code ?? null, issue ?? null, customer_details ?? null,
       tech_notes ?? null, notes ?? null, remarks ?? null, instructions ?? null,
       warranty_days === undefined ? null : parseInt(warranty_days, 10) || 0]
    );
    if (!rows[0]) throw fail(404, "Job not found");
    res.json(rows[0]);
  })
);

// Replace the photo set on a job (warranty / fault evidence, added over time).
router.patch(
  "/:id/images",
  wrap(async (req, res) => {
    const images = req.body?.images;
    if (!Array.isArray(images)) throw fail(400, "images must be an array");
    const { rows } = await query(
      `UPDATE service_jobs SET images = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, JSON.stringify(images)]
    );
    if (!rows[0]) throw fail(404, "Job not found");
    res.json(rows[0]);
  })
);

// Move a job along the workflow (stamps ready_at / released_at on transition).
router.patch(
  "/:id/status",
  wrap(async (req, res) => {
    const status = req.body?.status;
    const allowed = ["received", "in_progress", "ready_for_pickup", "released"];
    if (!allowed.includes(status)) throw fail(400, "Invalid status");
    const { rows } = await query(
      `UPDATE service_jobs
       SET status = $2,
           ready_at    = CASE WHEN $2 = 'ready_for_pickup' AND ready_at IS NULL THEN now() ELSE ready_at END,
           released_at = CASE WHEN $2 = 'released' THEN now() ELSE released_at END
       WHERE id = $1 RETURNING *`,
      [req.params.id, status]
    );
    if (!rows[0]) throw fail(404, "Job not found");
    res.json(rows[0]);
  })
);

export default router;
