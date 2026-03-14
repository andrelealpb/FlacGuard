import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate } from '../services/auth.js';
import { generateStreamKey, getHlsUrl, getRtmpUrl, getRtmpPublicUrl, getHlsPublicUrl } from '../services/rtmp.js';
import { findRecordingByTimestamp, listRecordings } from '../services/recording.js';

const router = Router();

const VALID_MODELS = ['iM3 C', 'iM5 SC', 'iMX', 'IC3', 'IC5'];

// Derive camera_group from model
function groupFromModel(model) {
  return ['IC3', 'IC5'].includes(model) ? 'ic' : 'im';
}

// GET /api/cameras — List cameras with status
router.get('/', authenticate, async (req, res) => {
  try {
    const { pdv_id, status, model } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (pdv_id) {
      conditions.push(`c.pdv_id = $${idx++}`);
      params.push(pdv_id);
    }
    if (status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (model) {
      conditions.push(`c.model = $${idx++}`);
      params.push(model);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT c.*, p.name as pdv_name, p.code as pdv_code
       FROM cameras c JOIN pdvs p ON c.pdv_id = p.id
       ${where} ORDER BY p.name, c.name`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/models — List valid camera models
router.get('/models', authenticate, (_req, res) => {
  res.json(VALID_MODELS.map(m => ({
    model: m,
    group: groupFromModel(m),
    has_rtmp: !['IC3', 'IC5'].includes(m),
    description: {
      'iM3 C': 'Intelbras iM3 C — RTMP nativo',
      'iM5 SC': 'Intelbras iM5 SC — RTMP nativo (validado)',
      'iMX': 'Intelbras iMX — RTMP nativo',
      'IC3': 'Intelbras IC3 — legada, requer Pi Zero (RTSP→RTMP)',
      'IC5': 'Intelbras IC5 — legada, requer Pi Zero (RTSP→RTMP)',
    }[m],
  })));
});

// POST /api/cameras — Register new camera
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, pdv_id, model, location_description } = req.body;

    if (!name || !pdv_id || !model) {
      return res.status(400).json({ error: 'name, pdv_id and model are required' });
    }
    if (!VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` });
    }

    // Verify PDV exists
    const pdvCheck = await pool.query('SELECT id FROM pdvs WHERE id = $1', [pdv_id]);
    if (pdvCheck.rows.length === 0) {
      return res.status(400).json({ error: 'PDV not found' });
    }

    const streamKey = generateStreamKey();
    const camera_group = groupFromModel(model);

    const { rows } = await pool.query(
      `INSERT INTO cameras (name, stream_key, model, camera_group, location_description, pdv_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, streamKey, model, camera_group, location_description, pdv_id]
    );
    const camera = rows[0];
    res.status(201).json({
      ...camera,
      rtmp_url: getRtmpUrl(camera.stream_key),
      hls_url: getHlsUrl(camera.stream_key),
      rtmp_public_url: getRtmpPublicUrl(camera.stream_key),
      hls_public_url: getHlsPublicUrl(camera.stream_key),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id — Camera details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, p.name as pdv_name, p.code as pdv_code
       FROM cameras c JOIN pdvs p ON c.pdv_id = p.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    const camera = rows[0];
    res.json({
      ...camera,
      rtmp_url: getRtmpUrl(camera.stream_key),
      hls_url: getHlsUrl(camera.stream_key),
      rtmp_public_url: getRtmpPublicUrl(camera.stream_key),
      hls_public_url: getHlsPublicUrl(camera.stream_key),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cameras/:id — Update camera
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { name, model, location_description, pdv_id } = req.body;

    if (model && !VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` });
    }
    if (pdv_id) {
      const pdvCheck = await pool.query('SELECT id FROM pdvs WHERE id = $1', [pdv_id]);
      if (pdvCheck.rows.length === 0) {
        return res.status(400).json({ error: 'PDV not found' });
      }
    }

    const camera_group = model ? groupFromModel(model) : undefined;

    const { rows } = await pool.query(
      `UPDATE cameras SET
         name = COALESCE($2, name),
         model = COALESCE($3, model),
         camera_group = COALESCE($4, camera_group),
         location_description = COALESCE($5, location_description),
         pdv_id = COALESCE($6, pdv_id),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, model, camera_group, location_description, pdv_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id — Remove camera
router.delete('/:id', authenticate, async (req, res) => {
  try {
    // Check if camera has recordings
    const recCheck = await pool.query(
      'SELECT COUNT(*) as count FROM recordings WHERE camera_id = $1',
      [req.params.id]
    );
    if (parseInt(recCheck.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'Cannot delete camera with existing recordings. Remove recordings first.',
      });
    }

    // Delete events first (FK dependency)
    await pool.query('DELETE FROM events WHERE camera_id = $1', [req.params.id]);

    const { rows } = await pool.query(
      'DELETE FROM cameras WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    res.json({ message: 'Camera deleted', camera: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/live — HLS stream URL
router.get('/:id/live', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT stream_key, status FROM cameras WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    const { stream_key, status } = rows[0];
    res.json({
      hls_url: getHlsUrl(stream_key),
      rtmp_url: getRtmpUrl(stream_key),
      rtmp_public_url: getRtmpPublicUrl(stream_key),
      hls_public_url: getHlsPublicUrl(stream_key),
      status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/recordings — List recordings by period
router.get('/:id/recordings', authenticate, async (req, res) => {
  try {
    const { from, to, limit, offset } = req.query;
    const recordings = await listRecordings(req.params.id, {
      from, to,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    });
    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/recording?timestamp=...&duration=... — Find recording by exact timestamp
router.get('/:id/recording', authenticate, async (req, res) => {
  try {
    const { timestamp, duration } = req.query;
    if (!timestamp) return res.status(400).json({ error: 'timestamp is required' });
    const recording = await findRecordingByTimestamp(
      req.params.id,
      timestamp,
      parseInt(duration) || 300
    );
    if (!recording) return res.status(404).json({ error: 'No recording found for this timestamp' });
    res.json(recording);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/snapshot — Current frame (JPEG)
router.get('/:id/snapshot', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT stream_key, status FROM cameras WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    if (rows[0].status !== 'online') {
      return res.status(503).json({ error: 'Camera is offline' });
    }
    // TODO: extract frame from HLS stream via FFmpeg
    res.status(501).json({ error: 'Snapshot extraction not yet implemented' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id/download?from=...&to=... — Download MP4 clip
router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    // TODO: extract and serve MP4 clip via FFmpeg
    res.status(501).json({ error: 'Download not yet implemented' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
