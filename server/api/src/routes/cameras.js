import { Router } from 'express';
import { existsSync, statSync } from 'fs';
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
       FROM cameras c LEFT JOIN pdvs p ON c.pdv_id = p.id
       ${where} ORDER BY p.name, c.name`,
      params
    );
    // Ensure new columns have defaults for cameras created before migration
    res.json(rows.map(r => ({
      ...r,
      recording_mode: r.recording_mode || 'continuous',
      retention_days: r.retention_days || 21,
      motion_sensitivity: r.motion_sensitivity || 5,
    })));
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

// GET /api/cameras/stream-names — Map stream keys to camera names (for RTMP stats)
router.get('/stream-names', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT stream_key, c.name, c.id as camera_id, p.name as pdv_name
       FROM cameras c LEFT JOIN pdvs p ON c.pdv_id = p.id`
    );
    const map = {};
    for (const row of rows) {
      map[row.stream_key] = {
        name: row.name,
        pdv_name: row.pdv_name,
        camera_id: row.camera_id,
      };
    }
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/disk-usage — Disk usage per camera (recordings + faces)
router.get('/disk-usage', authenticate, async (_req, res) => {
  try {
    // Backfill any recordings missing file_size
    const { rows: missing } = await pool.query(
      'SELECT id, file_path FROM recordings WHERE file_size IS NULL OR file_size = 0'
    );
    if (missing.length > 0) {
      let fixed = 0;
      for (const rec of missing) {
        try {
          if (rec.file_path && existsSync(rec.file_path)) {
            const size = statSync(rec.file_path).size;
            if (size > 0) {
              await pool.query('UPDATE recordings SET file_size = $1 WHERE id = $2', [size, rec.id]);
              fixed++;
            }
          }
        } catch { /* skip */ }
      }
      if (fixed > 0) console.log(`[DiskUsage] Backfilled file_size for ${fixed}/${missing.length} recordings`);
    }

    // Recording totals per camera
    const { rows: recRows } = await pool.query(
      `SELECT c.id as camera_id, c.name, c.retention_days,
              COALESCE(SUM(r.file_size), 0)::text as recording_bytes,
              COUNT(r.id)::int as recording_count
       FROM cameras c
       LEFT JOIN recordings r ON r.camera_id = c.id
       GROUP BY c.id, c.name, c.retention_days`
    );

    // Face image sizes per camera — scan face_image paths on disk
    const { rows: faceRows } = await pool.query(
      `SELECT camera_id, face_image FROM face_embeddings WHERE face_image IS NOT NULL`
    );
    const faceSizeMap = {};   // camera_id -> { bytes, count }
    for (const f of faceRows) {
      try {
        if (f.face_image && existsSync(f.face_image)) {
          const sz = statSync(f.face_image).size;
          if (!faceSizeMap[f.camera_id]) faceSizeMap[f.camera_id] = { bytes: 0, count: 0 };
          faceSizeMap[f.camera_id].bytes += sz;
          faceSizeMap[f.camera_id].count++;
        }
      } catch { /* skip */ }
    }

    // Oldest recording per camera
    const { rows: oldestRows } = await pool.query(
      `SELECT camera_id, MIN(started_at) as oldest_recording_at
       FROM recordings GROUP BY camera_id`
    );
    const oldestMap = {};
    for (const o of oldestRows) {
      oldestMap[o.camera_id] = o.oldest_recording_at;
    }

    const rows = recRows.map(r => {
      const face = faceSizeMap[r.camera_id] || { bytes: 0, count: 0 };
      const recBytes = parseInt(r.recording_bytes) || 0;
      return {
        camera_id: r.camera_id,
        name: r.name,
        retention_days: r.retention_days,
        total_bytes: String(recBytes + face.bytes),
        recording_bytes: r.recording_bytes,
        recording_count: r.recording_count,
        face_bytes: String(face.bytes),
        face_count: face.count,
        oldest_recording_at: oldestMap[r.camera_id] || null,
      };
    });
    rows.sort((a, b) => parseInt(b.total_bytes) - parseInt(a.total_bytes));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras — Register new camera
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, pdv_id, model, location_description, recording_mode, retention_days, motion_sensitivity, storage_quota_gb } = req.body;

    if (!name || !pdv_id || !model) {
      return res.status(400).json({ error: 'name, pdv_id and model are required' });
    }
    if (!VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` });
    }
    if (recording_mode && !['continuous', 'motion'].includes(recording_mode)) {
      return res.status(400).json({ error: 'recording_mode must be "continuous" or "motion"' });
    }
    if (retention_days !== undefined && (retention_days < 1 || retention_days > 60)) {
      return res.status(400).json({ error: 'retention_days must be between 1 and 60' });
    }
    if (motion_sensitivity !== undefined && (motion_sensitivity < 1 || motion_sensitivity > 100)) {
      return res.status(400).json({ error: 'motion_sensitivity must be between 1 and 100' });
    }

    // Verify PDV exists
    const pdvCheck = await pool.query('SELECT id FROM pdvs WHERE id = $1', [pdv_id]);
    if (pdvCheck.rows.length === 0) {
      return res.status(400).json({ error: 'PDV not found' });
    }

    const streamKey = generateStreamKey();
    const camera_group = groupFromModel(model);

    const { rows } = await pool.query(
      `INSERT INTO cameras (name, stream_key, model, camera_group, location_description, pdv_id, recording_mode, retention_days, motion_sensitivity, storage_quota_gb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [name, streamKey, model, camera_group, location_description, pdv_id,
       recording_mode || 'continuous', retention_days || 21, motion_sensitivity || 5,
       storage_quota_gb || null]
    );
    const camera = rows[0];
    res.status(201).json({
      ...camera,
      rtmp_url: getRtmpUrl(camera.stream_key),
      hls_url: getHlsUrl(camera.stream_key),
      rtmp_public_url: await getRtmpPublicUrl(camera.stream_key),
      hls_public_url: await getHlsPublicUrl(camera.stream_key),
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
       FROM cameras c LEFT JOIN pdvs p ON c.pdv_id = p.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Camera not found' });
    const camera = rows[0];
    res.json({
      ...camera,
      rtmp_url: getRtmpUrl(camera.stream_key),
      hls_url: getHlsUrl(camera.stream_key),
      rtmp_public_url: await getRtmpPublicUrl(camera.stream_key),
      hls_public_url: await getHlsPublicUrl(camera.stream_key),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cameras/:id — Update camera
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { name, model, location_description, pdv_id, recording_mode, retention_days, motion_sensitivity, storage_quota_gb } = req.body;

    if (model && !VALID_MODELS.includes(model)) {
      return res.status(400).json({ error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` });
    }
    if (pdv_id) {
      const pdvCheck = await pool.query('SELECT id FROM pdvs WHERE id = $1', [pdv_id]);
      if (pdvCheck.rows.length === 0) {
        return res.status(400).json({ error: 'PDV not found' });
      }
    }
    if (recording_mode && !['continuous', 'motion'].includes(recording_mode)) {
      return res.status(400).json({ error: 'recording_mode must be "continuous" or "motion"' });
    }
    if (retention_days !== undefined && (retention_days < 1 || retention_days > 60)) {
      return res.status(400).json({ error: 'retention_days must be between 1 and 60' });
    }
    if (motion_sensitivity !== undefined && (motion_sensitivity < 1 || motion_sensitivity > 100)) {
      return res.status(400).json({ error: 'motion_sensitivity must be between 1 and 100' });
    }
    if (storage_quota_gb !== undefined && storage_quota_gb !== null && (storage_quota_gb < 0.1 || storage_quota_gb > 1000)) {
      return res.status(400).json({ error: 'storage_quota_gb must be between 0.1 and 1000' });
    }

    const camera_group = model ? groupFromModel(model) : undefined;

    // Build dynamic SET clause to handle storage_quota_gb (which can be explicitly null)
    const sets = [
      'name = COALESCE($2, name)',
      'model = COALESCE($3, model)',
      'camera_group = COALESCE($4, camera_group)',
      'location_description = COALESCE($5, location_description)',
      'pdv_id = COALESCE($6, pdv_id)',
      'recording_mode = COALESCE($7, recording_mode)',
      'retention_days = COALESCE($8, retention_days)',
      'motion_sensitivity = COALESCE($9, motion_sensitivity)',
      'updated_at = now()',
    ];
    const params = [req.params.id, name, model, camera_group, location_description, pdv_id,
       recording_mode, retention_days, motion_sensitivity];

    if (storage_quota_gb !== undefined) {
      params.push(storage_quota_gb);
      sets.push(`storage_quota_gb = $${params.length}`);
    }

    const { rows } = await pool.query(
      `UPDATE cameras SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
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
      rtmp_public_url: await getRtmpPublicUrl(stream_key),
      hls_public_url: await getHlsPublicUrl(stream_key),
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
