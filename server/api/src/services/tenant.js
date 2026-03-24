import { pool } from '../db/pool.js';

/**
 * Extract tenant_id from the authenticated request.
 * Works with JWT, API Key, and gateway (X-Internal-Key) auth.
 */
export function getTenantId(req) {
  return req.auth?.tenantId || req.auth?.user?.tenant_id || req.auth?.key?.tenant_id;
}

/**
 * Build a tenant filter condition for SQL queries.
 * Returns { condition, param, idx } to append to WHERE clauses.
 *
 * Usage:
 *   const tf = tenantFilter(req, idx);
 *   conditions.push(tf.condition);
 *   params.push(tf.param);
 *   idx = tf.idx;
 */
export function tenantFilter(req, paramIdx = 1, alias = '') {
  const tenantId = getTenantId(req);
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  return {
    condition: `${col} = $${paramIdx}`,
    param: tenantId,
    idx: paramIdx + 1,
  };
}

/**
 * Get tenant slug by tenant_id (cached).
 */
const slugCache = new Map();

export async function getTenantSlug(tenantId) {
  if (slugCache.has(tenantId)) return slugCache.get(tenantId);
  const { rows } = await pool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
  const slug = rows[0]?.slug || 'default';
  slugCache.set(tenantId, slug);
  return slug;
}

/**
 * Get tenant_id by slug.
 */
export async function getTenantBySlug(slug) {
  const { rows } = await pool.query('SELECT id FROM tenants WHERE slug = $1 AND is_active = true', [slug]);
  return rows[0]?.id || null;
}
