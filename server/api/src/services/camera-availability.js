import { pool } from '../db/pool.js';

/**
 * Log a camera status transition (online ↔ offline).
 * Closes the previous open record, filters micro-interruptions (≤30s),
 * and opens a new record for the current status.
 */
export async function logCameraStatusChange(cameraId, tenantId, newStatus) {
  // Close previous open record
  await pool.query(
    `UPDATE camera_availability_log SET ended_at = now()
     WHERE camera_id = $1 AND ended_at IS NULL`,
    [cameraId]
  );

  // Filter micro-interruptions: if last record was ≤30s, delete it
  await pool.query(
    `DELETE FROM camera_availability_log
     WHERE camera_id = $1 AND ended_at IS NOT NULL
     AND EXTRACT(EPOCH FROM (ended_at - started_at)) <= 30
     AND started_at > now() - interval '1 minute'`,
    [cameraId]
  );

  // Open new record
  await pool.query(
    `INSERT INTO camera_availability_log (camera_id, tenant_id, status)
     VALUES ($1, $2, $3)`,
    [cameraId, tenantId, newStatus]
  );
}
