import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';
import { getTenantId } from '../services/tenant.js';
import crypto from 'crypto';

const router = Router();

// GET /api/webhooks
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { rows } = await pool.query(
      'SELECT id, url, events, is_active, created_at FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks — Register a new webhook
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { url, events = [] } = req.body;
    const secret = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO webhooks (url, events, secret, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [url, events, secret, tenantId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/webhooks/:id
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { rowCount } = await pool.query('DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Webhook not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
