import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../services/auth.js';
import { fetchAllStores, isPulseConfigured } from '../services/pulse.js';
import { getVisitorsByPdv } from '../services/face-recognition.js';
import { getTenantId } from '../services/tenant.js';

const router = Router();

// GET /api/pdvs — List PDVs with camera counts and status
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { rows } = await pool.query(
      `SELECT p.*,
         COUNT(c.id) as camera_count,
         COUNT(c.id) FILTER (WHERE c.status = 'online') as cameras_online,
         COUNT(c.id) FILTER (WHERE c.status = 'offline') as cameras_offline
       FROM pdvs p
       LEFT JOIN cameras c ON c.pdv_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id
       ORDER BY p.name`,
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pdvs/sync — Sync PDVs from HappyDoPulse API
router.post('/sync', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!(await isPulseConfigured())) {
      return res.status(400).json({
        error: 'Pulse credentials not configured. Set PULSE_EMAIL and PULSE_PASSWORD.',
      });
    }

    const stores = await fetchAllStores();
    let created = 0;
    let updated = 0;

    for (const store of stores) {
      const { rows } = await pool.query(
        'SELECT id FROM pdvs WHERE pulse_id = $1 AND tenant_id = $2',
        [store.id, tenantId]
      );

      if (rows.length === 0) {
        // Insert new PDV
        await pool.query(
          `INSERT INTO pdvs (pulse_id, code, name, address, bairro, city, state, cep, bandeira, latitude, longitude, is_active, pulse_synced_at, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13)`,
          [
            store.id,
            store.code,
            store.name,
            store.address || '',
            store.bairro,
            store.cidade || 'João Pessoa',
            store.estado || 'PB',
            store.cep,
            store.bandeira,
            store.latitude ? parseFloat(store.latitude) : null,
            store.longitude ? parseFloat(store.longitude) : null,
            store.active,
            tenantId,
          ]
        );
        created++;
      } else {
        // Update existing PDV
        await pool.query(
          `UPDATE pdvs SET
             code = $2, name = $3, address = $4, bairro = $5,
             city = $6, state = $7, cep = $8, bandeira = $9,
             latitude = $10, longitude = $11, is_active = $12,
             pulse_synced_at = now(), updated_at = now()
           WHERE pulse_id = $1 AND tenant_id = $13`,
          [
            store.id,
            store.code,
            store.name,
            store.address || '',
            store.bairro,
            store.cidade || 'João Pessoa',
            store.estado || 'PB',
            store.cep,
            store.bandeira,
            store.latitude ? parseFloat(store.latitude) : null,
            store.longitude ? parseFloat(store.longitude) : null,
            store.active,
            tenantId,
          ]
        );
        updated++;
      }
    }

    res.json({
      message: 'Sync completed',
      total_from_pulse: stores.length,
      created,
      updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdvs/pulse-status — Check Pulse integration status
router.get('/pulse-status', authenticate, async (_req, res) => {
  res.json({
    configured: await isPulseConfigured(),
    api_url: process.env.PULSE_API_URL || 'https://happydopulse-production.up.railway.app/api',
  });
});

// POST /api/pdvs
router.post('/', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { name, address, city = 'João Pessoa', state = 'PB', bairro, cep, bandeira } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO pdvs (name, address, city, state, bairro, cep, bandeira, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, address, city, state, bairro, cep, bandeira, tenantId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdvs/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { rows } = await pool.query(
      `SELECT p.*,
         json_agg(json_build_object(
           'id', c.id, 'name', c.name, 'status', c.status,
           'stream_key', c.stream_key, 'model', c.model,
           'camera_group', c.camera_group, 'location_description', c.location_description
         )) FILTER (WHERE c.id IS NOT NULL) as cameras
       FROM pdvs p
       LEFT JOIN cameras c ON c.pdv_id = p.id
       WHERE p.id = $1 AND p.tenant_id = $2
       GROUP BY p.id`,
      [req.params.id, tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'PDV not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pdvs/:id
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { name, address, city, state, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE pdvs SET
         name = COALESCE($2, name),
         address = COALESCE($3, address),
         city = COALESCE($4, city),
         state = COALESCE($5, state),
         is_active = COALESCE($6, is_active),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $7 RETURNING *`,
      [req.params.id, name, address, city, state, is_active, tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'PDV not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdvs/:id/events
router.get('/:id/events', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { type, limit = 50, offset = 0 } = req.query;
    const conditions = ['c.pdv_id = $1', 'c.tenant_id = $2'];
    const params = [req.params.id, tenantId];
    let idx = 3;

    if (type) {
      conditions.push(`e.type = $${idx++}`);
      params.push(type);
    }

    const where = conditions.join(' AND ');
    const { rows } = await pool.query(
      `SELECT e.*, c.name as camera_name
       FROM events e JOIN cameras c ON e.camera_id = c.id
       WHERE ${where}
       ORDER BY e.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pdvs/:id/visitors — Distinct visitors per day
// :id can be "all" or a single PDV id. Also supports ?pdv_ids=id1,id2,id3 for multi-select.
router.get('/:id/visitors', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { from, to, pdv_ids } = req.query;

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 7);

    const dateFrom = from || defaultFrom.toISOString().split('T')[0];
    const dateTo = to || now.toISOString().split('T')[0];

    // Support multi-PDV via query param or single via path param
    let pdvIds = null;
    if (pdv_ids) {
      pdvIds = pdv_ids.split(',').filter(Boolean);
    } else if (id !== 'all') {
      pdvIds = [id];
    }

    const visitors = await getVisitorsByPdv(pdvIds, dateFrom, dateTo);
    res.json({ pdv_id: id, from: dateFrom, to: dateTo, days: visitors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
