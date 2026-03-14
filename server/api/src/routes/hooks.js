import { Router } from 'express';
import { pool } from '../db/pool.js';
import { onCameraOnline, onCameraOffline } from '../services/motion-detector.js';
import { startContinuousRecording, stopRecording } from '../services/recorder.js';

const router = Router();

// GET /hooks/on-publish — Called by Nginx-RTMP when a stream starts
router.get('/on-publish', async (req, res) => {
  try {
    const { name: streamKey, addr } = req.query;

    // Validate stream key
    const { rows } = await pool.query(
      'SELECT id, recording_mode, name FROM cameras WHERE stream_key = $1',
      [streamKey]
    );

    if (rows.length === 0) {
      // Debug: dump all stream keys from DB for comparison
      const { rows: allCams } = await pool.query('SELECT stream_key, length(stream_key) as len FROM cameras');
      console.log(`Rejected stream key: "${streamKey}" (len=${streamKey?.length}) from ${addr}`);
      console.log(`DB stream keys: ${JSON.stringify(allCams.map(r => ({ key: r.stream_key, len: r.len })))}`);
      return res.status(403).end();
    }

    const camera = rows[0];

    // Update camera status to online
    await pool.query(
      `UPDATE cameras SET status = 'online', last_seen_at = now(), updated_at = now()
       WHERE stream_key = $1`,
      [streamKey]
    );

    // Create online event
    await pool.query(
      `INSERT INTO events (camera_id, type, payload)
       VALUES ($1, 'online', $2)`,
      [camera.id, JSON.stringify({ addr })]
    );

    // Notify motion detector that camera is online
    onCameraOnline(camera.id);

    // Start continuous recording if configured
    if (camera.recording_mode === 'continuous') {
      // Delay slightly to let HLS segments build up
      setTimeout(async () => {
        try {
          const { rows: camRows } = await pool.query(
            'SELECT id, name, stream_key, recording_mode FROM cameras WHERE id = $1',
            [camera.id]
          );
          if (camRows.length > 0 && camRows[0].recording_mode === 'continuous') {
            startContinuousRecording(camRows[0]);
          }
        } catch (err) {
          console.error(`Error starting continuous recording for ${camera.name}:`, err.message);
        }
      }, 15000); // Wait 15s for HLS segments to be available
    }

    console.log(`Stream started: ${streamKey} (${camera.name}) from ${addr}`);
    res.status(200).end();
  } catch (err) {
    console.error('on-publish error:', err.message);
    res.status(500).end();
  }
});

// GET /hooks/on-publish-done — Called when stream stops
router.get('/on-publish-done', async (req, res) => {
  try {
    const { name: streamKey } = req.query;

    const { rows } = await pool.query(
      `UPDATE cameras SET status = 'offline', updated_at = now()
       WHERE stream_key = $1 RETURNING id, name`,
      [streamKey]
    );

    if (rows.length > 0) {
      await pool.query(
        `INSERT INTO events (camera_id, type, payload) VALUES ($1, 'offline', '{}')`,
        [rows[0].id]
      );

      // Notify motion detector and stop any recording
      onCameraOffline(rows[0].id);
      stopRecording(rows[0].id);
    }

    console.log(`Stream stopped: ${streamKey}`);
    res.status(200).end();
  } catch (err) {
    console.error('on-publish-done error:', err.message);
    res.status(500).end();
  }
});

// GET /hooks/on-record-done — Called when a recording segment finishes (nginx-rtmp native recording)
router.get('/on-record-done', async (req, res) => {
  try {
    const { name: streamKey, path: filePath } = req.query;

    const { rows: cameras } = await pool.query(
      'SELECT id FROM cameras WHERE stream_key = $1',
      [streamKey]
    );

    if (cameras.length > 0) {
      await pool.query(
        `INSERT INTO recordings (camera_id, file_path, started_at, recording_type)
         VALUES ($1, $2, now(), 'continuous')`,
        [cameras[0].id, filePath]
      );
    }

    console.log(`Recording done: ${streamKey} → ${filePath}`);
    res.status(200).end();
  } catch (err) {
    console.error('on-record-done error:', err.message);
    res.status(500).end();
  }
});

export default router;
