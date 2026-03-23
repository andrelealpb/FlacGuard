import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { hashPassword } from '../services/auth.js';

const router = Router();

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * Middleware: authenticate via X-Internal-Key header.
 * Shared secret between flac-guard-control and this node.
 */
function authenticateInternal(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!INTERNAL_KEY) {
    return res.status(503).json({ error: 'Internal API not configured (INTERNAL_API_KEY not set)' });
  }
  if (!key || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(INTERNAL_KEY))) {
    return res.status(401).json({ error: 'Invalid internal key' });
  }
  next();
}

router.use(authenticateInternal);

// ---------------------------------------------------------------------------
// GET /api/internal/health — Quick check that the node API is reachable
// ---------------------------------------------------------------------------
router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'flac-guard-node' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/internal/tenants — Create a new tenant (called by control VPS)
// ---------------------------------------------------------------------------
router.post('/tenants', async (req, res) => {
  try {
    const {
      tenant_id,
      name,
      slug,
      plan,
      max_pdvs,
      max_cameras_per_pdv,
      free_facial_per_pdv,
      retention_days,
      features,
    } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'name and slug are required' });
    }

    // Map control plan name to node plan level
    const planMap = {
      tester: 'starter',
      monitoring: 'professional',
      advanced: 'enterprise',
      ultra: 'enterprise',
    };
    const nodePlan = planMap[plan] || 'starter';

    const maxCameras = (max_pdvs || 1) * (max_cameras_per_pdv || 3);

    // Insert tenant
    const { rows } = await pool.query(
      `INSERT INTO tenants (
        id, name, slug, plan, max_cameras, max_pdvs, max_cameras_per_pdv,
        free_facial_per_pdv, retention_days, features, is_active
      ) VALUES (
        COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9, $10, true
      ) RETURNING *`,
      [
        tenant_id || null,
        name,
        slug,
        nodePlan,
        maxCameras,
        max_pdvs || 1,
        max_cameras_per_pdv || 3,
        free_facial_per_pdv || 1,
        retention_days || 21,
        JSON.stringify(features || {}),
      ]
    );

    const tenant = rows[0];

    // Create admin user for the tenant
    const adminEmail = `admin@${slug}.flacguard`;
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const hashedPw = await hashPassword(tempPassword);

    await pool.query(
      `INSERT INTO users (email, hashed_password, full_name, role, tenant_id)
       VALUES ($1, $2, $3, 'admin', $4)
       ON CONFLICT (email) DO NOTHING`,
      [adminEmail, hashedPw, name, tenant.id]
    );

    res.status(201).json({
      tenant_id: tenant.id,
      slug: tenant.slug,
      admin_credentials: {
        email: adminEmail,
        password: tempPassword,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Tenant slug already exists' });
    }
    console.error('[Internal] Create tenant error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/internal/tenants/:id — Deactivate tenant
// ---------------------------------------------------------------------------
router.delete('/tenants/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await pool.query(
      `UPDATE tenants SET is_active = false, updated_at = now() WHERE id = $1`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Deactivate all users for this tenant
    await pool.query(
      `UPDATE users SET is_active = false WHERE tenant_id = $1`,
      [id]
    );

    // Deactivate all API keys for this tenant
    await pool.query(
      `UPDATE api_keys SET is_active = false WHERE tenant_id = $1`,
      [id]
    );

    res.json({ ok: true, message: 'Tenant deactivated' });
  } catch (err) {
    console.error('[Internal] Delete tenant error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/internal/tenants/:id/limits — Update tenant limits after upgrade
// ---------------------------------------------------------------------------
router.put('/tenants/:id/limits', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      max_pdvs,
      max_cameras_per_pdv,
      free_facial_per_pdv,
      retention_days,
      features,
    } = req.body;

    const maxCameras = (max_pdvs || 1) * (max_cameras_per_pdv || 3);

    const { rowCount, rows } = await pool.query(
      `UPDATE tenants SET
        max_pdvs = COALESCE($2, max_pdvs),
        max_cameras_per_pdv = COALESCE($3, max_cameras_per_pdv),
        free_facial_per_pdv = COALESCE($4, free_facial_per_pdv),
        retention_days = COALESCE($5, retention_days),
        features = COALESCE($6, features),
        max_cameras = $7,
        updated_at = now()
      WHERE id = $1
      RETURNING id, slug, max_pdvs, max_cameras_per_pdv, retention_days, features, max_cameras`,
      [
        id,
        max_pdvs,
        max_cameras_per_pdv,
        free_facial_per_pdv,
        retention_days,
        features ? JSON.stringify(features) : null,
        maxCameras,
      ]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[Internal] Update limits error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/internal/tenants/:id/usage — Return current usage stats
// ---------------------------------------------------------------------------
router.get('/tenants/:id/usage', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify tenant exists
    const { rows: tenantRows } = await pool.query(
      `SELECT id, slug, is_active FROM tenants WHERE id = $1`,
      [id]
    );
    if (tenantRows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Count cameras
    const { rows: camRows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'online') AS cameras_online,
        COUNT(*) AS cameras_total
      FROM cameras WHERE tenant_id = $1`,
      [id]
    );

    // Count PDVs
    const { rows: pdvRows } = await pool.query(
      `SELECT COUNT(*) AS pdv_count FROM pdvs WHERE tenant_id = $1`,
      [id]
    );

    // Count billable cameras (cameras with purpose != 'face' or all cameras)
    const { rows: billableRows } = await pool.query(
      `SELECT COUNT(*) AS billable_cameras FROM cameras WHERE tenant_id = $1`,
      [id]
    );

    // Approximate storage used (count recordings * avg size)
    const { rows: storageRows } = await pool.query(
      `SELECT COALESCE(SUM(file_size), 0) AS storage_bytes
       FROM recordings WHERE tenant_id = $1`,
      [id]
    );

    const storageGb = parseFloat((Number(storageRows[0].storage_bytes) / (1024 * 1024 * 1024)).toFixed(2));

    res.json({
      tenant_id: id,
      camera_count: parseInt(camRows[0].cameras_total),
      cameras_online: parseInt(camRows[0].cameras_online),
      pdv_count: parseInt(pdvRows[0].pdv_count),
      billable_cameras: parseInt(billableRows[0].billable_cameras),
      storage_used_gb: storageGb,
    });
  } catch (err) {
    console.error('[Internal] Usage error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
