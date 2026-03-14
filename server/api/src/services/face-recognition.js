import { pool } from '../db/pool.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://face-service:8001';
const FACE_DIR = '/data/recordings/faces';
const SIMILARITY_THRESHOLD = 0.85; // Watchlist alert threshold
const VISITOR_THRESHOLD = 0.75;    // Same-person threshold for visitor dedup

// Ensure face image directory exists
if (!existsSync(FACE_DIR)) {
  try { mkdirSync(FACE_DIR, { recursive: true }); } catch { /* ok */ }
}

/**
 * Send a frame (JPEG buffer) to the face detection service.
 * Returns array of { bbox, confidence, embedding, face_image_b64 }
 */
export async function detectFaces(jpegBuffer) {
  const formData = new FormData();
  formData.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(`${FACE_SERVICE_URL}/detect`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Face detection failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.faces || [];
}

/**
 * Generate embedding for a search photo.
 * Returns { embedding, confidence }
 */
export async function embedPhoto(jpegBuffer) {
  const formData = new FormData();
  formData.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'photo.jpg');

  const res = await fetch(`${FACE_SERVICE_URL}/embed`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Face embedding failed (${res.status}): ${text}`);
  }

  return await res.json();
}

/**
 * Store detected face embeddings in database.
 */
export async function storeFaceEmbeddings(cameraId, faces, detectedAt) {
  const ids = [];

  for (const face of faces) {
    // Save face crop image
    let facePath = null;
    if (face.face_image_b64) {
      const filename = `face-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      facePath = join(FACE_DIR, filename);
      try {
        writeFileSync(facePath, Buffer.from(face.face_image_b64, 'base64'));
      } catch {
        facePath = null;
      }
    }

    // Serialize embedding as pgvector format
    const embeddingStr = `[${face.embedding.join(',')}]`;

    const { rows } = await pool.query(
      `INSERT INTO face_embeddings (camera_id, embedding, face_image, confidence, detected_at)
       VALUES ($1, $2::vector, $3, $4, $5)
       RETURNING id`,
      [cameraId, embeddingStr, facePath, face.confidence, detectedAt || new Date()]
    );

    ids.push(rows[0].id);
  }

  return ids;
}

/**
 * Check detected faces against the active watchlist.
 * Returns matches: [{ watchlist_id, face_embedding_id, similarity, watchlist_entry }]
 */
export async function checkWatchlist(cameraId, faceEmbeddingIds) {
  const matches = [];

  // Get active watchlist entries
  const { rows: watchlist } = await pool.query(
    'SELECT id, name, alert_type, embedding FROM face_watchlist WHERE is_active = true'
  );

  if (watchlist.length === 0) return matches;

  for (const embId of faceEmbeddingIds) {
    // For each stored face embedding, compare against all watchlist entries
    for (const entry of watchlist) {
      const { rows } = await pool.query(
        `SELECT 1 - (fe.embedding <=> fw.embedding) AS similarity
         FROM face_embeddings fe, face_watchlist fw
         WHERE fe.id = $1 AND fw.id = $2`,
        [embId, entry.id]
      );

      if (rows.length > 0 && rows[0].similarity >= SIMILARITY_THRESHOLD) {
        // Create alert
        const { rows: alertRows } = await pool.query(
          `INSERT INTO face_alerts (watchlist_id, face_embedding_id, camera_id, similarity)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [entry.id, embId, cameraId, rows[0].similarity]
        );

        // Create event
        await pool.query(
          `INSERT INTO events (camera_id, type, payload)
           VALUES ($1, 'ai_alert', $2)`,
          [cameraId, JSON.stringify({
            alert_type: 'watchlist_match',
            watchlist_id: entry.id,
            watchlist_name: entry.name,
            similarity: parseFloat(rows[0].similarity.toFixed(3)),
            face_alert_id: alertRows[0].id,
          })]
        );

        matches.push({
          watchlist_id: entry.id,
          face_embedding_id: embId,
          similarity: rows[0].similarity,
          watchlist_entry: { id: entry.id, name: entry.name, alert_type: entry.alert_type },
        });

        console.log(`[Face] WATCHLIST MATCH: "${entry.name}" (${entry.alert_type}) on camera ${cameraId} — ${(rows[0].similarity * 100).toFixed(1)}%`);
      }
    }
  }

  return matches;
}

/**
 * Search for a face across all stored embeddings.
 * Returns appearances sorted by similarity desc.
 */
export async function searchFace(embedding, options = {}) {
  const { limit = 50, minSimilarity = 0.6, cameraIds, from, to } = options;
  const embeddingStr = `[${embedding.join(',')}]`;

  let query = `
    SELECT fe.id, fe.camera_id, fe.face_image, fe.confidence, fe.detected_at,
           1 - (fe.embedding <=> $1::vector) AS similarity,
           c.name AS camera_name,
           p.name AS pdv_name, p.id AS pdv_id
    FROM face_embeddings fe
    JOIN cameras c ON c.id = fe.camera_id
    JOIN pdvs p ON p.id = c.pdv_id
    WHERE 1 - (fe.embedding <=> $1::vector) >= $2
  `;
  const params = [embeddingStr, minSimilarity];
  let paramIdx = 3;

  if (cameraIds && cameraIds.length > 0) {
    query += ` AND fe.camera_id = ANY($${paramIdx})`;
    params.push(cameraIds);
    paramIdx++;
  }

  if (from) {
    query += ` AND fe.detected_at >= $${paramIdx}`;
    params.push(from);
    paramIdx++;
  }

  if (to) {
    query += ` AND fe.detected_at <= $${paramIdx}`;
    params.push(to);
    paramIdx++;
  }

  query += ` ORDER BY similarity DESC LIMIT $${paramIdx}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Count distinct visitors for a camera on a given date.
 * Uses vector similarity to deduplicate faces.
 */
export async function countDistinctVisitors(cameraId, date) {
  // Get all face embeddings for this camera on this date
  const { rows: faces } = await pool.query(
    `SELECT id, embedding
     FROM face_embeddings
     WHERE camera_id = $1
       AND detected_at::date = $2
     ORDER BY detected_at`,
    [cameraId, date]
  );

  if (faces.length === 0) return 0;

  // Cluster faces by similarity (greedy: each new face that doesn't match
  // any existing cluster centroid starts a new cluster)
  const clusters = [];

  for (const face of faces) {
    let matched = false;

    for (const cluster of clusters) {
      // Compare with cluster representative
      const { rows } = await pool.query(
        `SELECT 1 - (
           (SELECT embedding FROM face_embeddings WHERE id = $1)
           <=>
           (SELECT embedding FROM face_embeddings WHERE id = $2)
         ) AS similarity`,
        [face.id, cluster.representative]
      );

      if (rows.length > 0 && rows[0].similarity >= VISITOR_THRESHOLD) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      clusters.push({ representative: face.id });
    }
  }

  // Upsert daily visitor count
  await pool.query(
    `INSERT INTO daily_visitors (camera_id, visit_date, count, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (camera_id, visit_date)
     DO UPDATE SET count = $3, updated_at = now()`,
    [cameraId, date, clusters.length]
  );

  return clusters.length;
}

/**
 * Get visitor counts for a PDV (all cameras) over a date range.
 */
export async function getVisitorsByPdv(pdvId, from, to) {
  if (pdvId) {
    const { rows } = await pool.query(
      `SELECT dv.visit_date, SUM(dv.count) AS total_visitors,
              json_agg(json_build_object('camera_id', dv.camera_id, 'camera_name', c.name, 'count', dv.count)) AS by_camera
       FROM daily_visitors dv
       JOIN cameras c ON c.id = dv.camera_id
       WHERE c.pdv_id = $1
         AND dv.visit_date >= $2
         AND dv.visit_date <= $3
       GROUP BY dv.visit_date
       ORDER BY dv.visit_date DESC`,
      [pdvId, from, to]
    );
    return rows;
  }
  // All PDVs
  const { rows } = await pool.query(
    `SELECT dv.visit_date, SUM(dv.count) AS total_visitors,
            json_agg(json_build_object('camera_id', dv.camera_id, 'camera_name', c.name, 'count', dv.count)) AS by_camera
     FROM daily_visitors dv
     JOIN cameras c ON c.id = dv.camera_id
     WHERE dv.visit_date >= $1
       AND dv.visit_date <= $2
     GROUP BY dv.visit_date
     ORDER BY dv.visit_date DESC`,
    [from, to]
  );
  return rows;
}

/**
 * Check if face-service is available.
 */
export async function isFaceServiceHealthy() {
  try {
    const res = await fetch(`${FACE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.model_loaded === true;
  } catch {
    return false;
  }
}
