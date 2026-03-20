import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';
import { getTenantId } from '../services/tenant.js';

const router = Router();

// GET /api/alerts — List system alerts (newest first)
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { resolved, type, limit = 50 } = req.query;
    const conditions = ['c.tenant_id = $1'];
    const params = [tenantId];
    let idx = 2;

    if (resolved !== undefined) {
      conditions.push(`a.resolved = $${idx++}`);
      params.push(resolved === 'true');
    }
    if (type) {
      conditions.push(`a.type = $${idx++}`);
      params.push(type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT a.*, c.name as camera_name
       FROM system_alerts a
       LEFT JOIN cameras c ON a.camera_id = c.id
       ${where}
       ORDER BY a.resolved ASC, a.severity = 'critical' DESC, a.created_at DESC
       LIMIT $${idx}`,
      [...params, parseInt(limit)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/active-count — Count of unresolved alerts (for badge)
router.get('/active-count', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE severity = 'critical')::int as critical,
         COUNT(*) FILTER (WHERE severity = 'warning')::int as warning,
         COUNT(*) FILTER (WHERE severity = 'info')::int as info,
         COUNT(*)::int as total
       FROM system_alerts a
       LEFT JOIN cameras c ON a.camera_id = c.id
       WHERE a.resolved = false AND (c.tenant_id = $1 OR a.camera_id IS NULL)`,
      [tenantId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:id/resolve — Resolve an alert
router.patch('/:id/resolve', authenticate, authorize('admin'), async (req, res) => {
  try {
    const userId = req.auth?.user?.id || null;
    const { rows } = await pool.query(
      `UPDATE system_alerts
       SET resolved = true, resolved_at = now(), resolved_by = $2
       WHERE id = $1 RETURNING *`,
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/alerts/:id — Delete an alert (admin only)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM system_alerts WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json({ message: 'Alert deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
