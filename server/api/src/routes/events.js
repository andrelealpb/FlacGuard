import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../services/auth.js';
import { getTenantId } from '../services/tenant.js';

const router = Router();

// GET /api/events — List events (motion, offline, online, error, ai_alert)
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { camera_id, pdv_id, type, from, to, limit = 50, offset = 0 } = req.query;
    const conditions = ['c.tenant_id = $1'];
    const params = [tenantId];
    let idx = 2;

    if (camera_id) {
      conditions.push(`e.camera_id = $${idx++}`);
      params.push(camera_id);
    }
    if (pdv_id) {
      conditions.push(`c.pdv_id = $${idx++}`);
      params.push(pdv_id);
    }
    if (type) {
      conditions.push(`e.type = $${idx++}`);
      params.push(type);
    }
    if (from) {
      conditions.push(`e.created_at >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`e.created_at <= $${idx++}`);
      params.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT e.*, c.name as camera_name, p.name as pdv_name
       FROM events e
       LEFT JOIN cameras c ON e.camera_id = c.id
       LEFT JOIN pdvs p ON c.pdv_id = p.id
       ${where} ORDER BY e.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
