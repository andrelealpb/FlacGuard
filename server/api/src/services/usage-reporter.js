import { pool } from '../db/pool.js';

const CONTROL_API_URL = process.env.CONTROL_API_URL || 'https://api.flactech.com.br';
const NODE_API_KEY = process.env.NODE_API_KEY || '';

/**
 * Report current usage for a tenant to the control API.
 * Called whenever cameras change (online/offline/create/delete).
 * Fails silently — usage reporting should never break camera operations.
 */
export async function reportUsage(tenantId) {
  if (!NODE_API_KEY) {
    console.warn('[UsageReporter] NODE_API_KEY not set, skipping report');
    return;
  }

  try {
    // Gather usage stats from DB
    const { rows: camRows } = await pool.query(
      `SELECT COUNT(*) AS camera_count FROM cameras WHERE tenant_id = $1`,
      [tenantId]
    );

    const { rows: pdvRows } = await pool.query(
      `SELECT COUNT(*) AS pdv_count FROM pdvs WHERE tenant_id = $1`,
      [tenantId]
    );

    const { rows: billableRows } = await pool.query(
      `SELECT COUNT(*) AS billable_cameras FROM cameras WHERE tenant_id = $1`,
      [tenantId]
    );

    const { rows: storageRows } = await pool.query(
      `SELECT COALESCE(SUM(file_size), 0) AS storage_bytes
       FROM recordings WHERE tenant_id = $1`,
      [tenantId]
    );

    const storageGb = parseFloat(
      (Number(storageRows[0].storage_bytes) / (1024 * 1024 * 1024)).toFixed(2)
    );

    const payload = {
      camera_count: parseInt(camRows[0].camera_count),
      pdv_count: parseInt(pdvRows[0].pdv_count),
      billable_cameras: parseInt(billableRows[0].billable_cameras),
      storage_used_gb: storageGb,
    };

    const url = `${CONTROL_API_URL}/api/internal/tenants/${tenantId}/usage`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': NODE_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[UsageReporter] POST ${url} → ${resp.status}: ${body}`);
    } else {
      console.log(`[UsageReporter] Reported usage for tenant ${tenantId}:`, payload);
    }
  } catch (err) {
    console.error(`[UsageReporter] Error reporting usage for tenant ${tenantId}:`, err.message);
  }
}

/**
 * Fire-and-forget wrapper — schedules report without blocking the caller.
 * Adds a small delay to let the DB transaction commit first.
 */
export function reportUsageAsync(tenantId) {
  if (!NODE_API_KEY || !tenantId) return;
  setTimeout(() => reportUsage(tenantId), 2000);
}
