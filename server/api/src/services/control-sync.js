import { pool } from '../db/pool.js';

const CONTROL_API_URL = process.env.CONTROL_API_URL;
const CONTROL_NODE_API_KEY = process.env.CONTROL_NODE_API_KEY;
const CONTROL_TENANT_ID = process.env.CONTROL_TENANT_ID;

/**
 * Sync PDVs from flac-guard-control for a given tenant.
 * Uses CONTROL_TENANT_ID to query the Control API, but saves with the local tenantId.
 * Non-blocking: caller should .catch(() => {}) to avoid unhandled rejections.
 */
export async function syncPdvsFromControl(tenantId) {
  if (!CONTROL_API_URL || !CONTROL_NODE_API_KEY) return { synced: 0 };

  const queryTenantId = CONTROL_TENANT_ID || tenantId;

  try {
    const res = await fetch(`${CONTROL_API_URL}/api/internal/tenants/${queryTenantId}/pdvs`, {
      headers: { 'X-API-Key': CONTROL_NODE_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { synced: 0 };

    const pdvs = await res.json();
    let synced = 0;

    for (const pdv of pdvs) {
      await pool.query(
        `INSERT INTO pdvs (id, tenant_id, name, address, bairro, city, state, cep, bandeira, code, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           name = $3, address = $4, bairro = $5, city = $6, state = $7,
           cep = $8, bandeira = $9, is_active = $11, updated_at = now()`,
        [pdv.id, tenantId, pdv.name, pdv.address || '', pdv.bairro || '',
         pdv.city || '', pdv.state || '', pdv.cep || '', pdv.bandeira || '',
         pdv.code || '', pdv.is_active]
      );
      synced++;
    }

    return { synced };
  } catch {
    return { synced: 0 };
  }
}
