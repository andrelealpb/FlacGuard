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
 * Detect persons (full body) in a frame using YOLOv8n.
 * Returns { persons: [{ bbox, confidence }], count }
 */
export async function detectPersons(jpegBuffer) {
  const formData = new FormData();
  formData.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'frame.jpg');

  const res = await fetch(`${FACE_SERVICE_URL}/detect-persons`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Person detection failed (${res.status}): ${text}`);
  }

  return await res.json();
}

/**
 * Store detected face embeddings in database.
 * Links identical faces to the same person_id while keeping all captures
 * for better search accuracy. Uses vector similarity to find matching persons.
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

    // Find an existing person_id by matching against recent embeddings (last 30 days)
    // Uses pgvector HNSW index for fast similarity search
    let personId = null;
    try {
      const { rows: matches } = await pool.query(
        `SELECT person_id, 1 - (embedding <=> $1::vector) AS similarity
         FROM face_embeddings
         WHERE person_id IS NOT NULL
           AND detected_at > now() - interval '30 days'
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        [embeddingStr]
      );

      if (matches.length > 0 && matches[0].similarity >= VISITOR_THRESHOLD) {
        personId = matches[0].person_id;
      }
    } catch {
      // If person matching fails, continue without linking
    }

    // Generate new person_id if no match found
    if (!personId) {
      const { rows: uuidRows } = await pool.query('SELECT uuid_generate_v4() AS id');
      personId = uuidRows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO face_embeddings (camera_id, embedding, face_image, confidence, detected_at, person_id)
       VALUES ($1, $2::vector, $3, $4, $5, $6)
       RETURNING id`,
      [cameraId, embeddingStr, facePath, face.confidence, detectedAt || new Date(), personId]
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
 * Uses person_id to count unique persons (much faster than O(n²) clustering).
 * Falls back to greedy clustering for faces without person_id (legacy data).
 */
export async function countDistinctVisitors(cameraId, date) {
  // Count distinct person_ids for this camera on this date
  const { rows: [result] } = await pool.query(
    `SELECT
       COUNT(DISTINCT person_id) AS linked_persons,
       COUNT(*) FILTER (WHERE person_id IS NULL) AS unlinked_faces
     FROM face_embeddings
     WHERE camera_id = $1
       AND detected_at::date = $2`,
    [cameraId, date]
  );

  if (!result || (parseInt(result.linked_persons) === 0 && parseInt(result.unlinked_faces) === 0)) {
    return 0;
  }

  let distinctCount = parseInt(result.linked_persons);

  // For legacy faces without person_id, use greedy clustering as fallback
  if (parseInt(result.unlinked_faces) > 0) {
    const { rows: unlinkedFaces } = await pool.query(
      `SELECT id, embedding
       FROM face_embeddings
       WHERE camera_id = $1
         AND detected_at::date = $2
         AND person_id IS NULL
       ORDER BY detected_at`,
      [cameraId, date]
    );

    const clusters = [];
    for (const face of unlinkedFaces) {
      let matched = false;
      for (const cluster of clusters) {
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
    distinctCount += clusters.length;
  }

  // Upsert daily visitor count
  await pool.query(
    `INSERT INTO daily_visitors (camera_id, visit_date, count, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (camera_id, visit_date)
     DO UPDATE SET count = $3, updated_at = now()`,
    [cameraId, date, distinctCount]
  );

  return distinctCount;
}

/**
 * Get visitor counts for a PDV (all cameras) over a date range.
 * Uses DISTINCT person_id across all cameras in the PDV to avoid
 * counting the same person seen by multiple cameras.
 * Falls back to daily_visitors table sums when person_id data is unavailable.
 */
export async function getVisitorsByPdv(pdvId, from, to) {
  const cameraFilter = pdvId
    ? 'c.pdv_id = $1'
    : '1=1';
  const params = pdvId ? [pdvId, from, to] : [from, to];
  const fromIdx = pdvId ? '$2' : '$1';
  const toIdx = pdvId ? '$3' : '$2';

  // Count distinct persons across all cameras per day (cross-camera dedup)
  const { rows } = await pool.query(
    `SELECT
       fe.detected_at::date AS visit_date,
       COUNT(DISTINCT fe.person_id) AS total_visitors,
       json_agg(DISTINCT jsonb_build_object(
         'camera_id', fe.camera_id,
         'camera_name', c.name,
         'count', cam_counts.cam_count
       )) AS by_camera
     FROM face_embeddings fe
     JOIN cameras c ON c.id = fe.camera_id
     JOIN (
       SELECT camera_id, detected_at::date AS d, COUNT(DISTINCT person_id) AS cam_count
       FROM face_embeddings
       WHERE person_id IS NOT NULL
         AND detected_at::date >= ${fromIdx}
         AND detected_at::date <= ${toIdx}
       GROUP BY camera_id, detected_at::date
     ) cam_counts ON cam_counts.camera_id = fe.camera_id AND cam_counts.d = fe.detected_at::date
     WHERE ${cameraFilter}
       AND fe.person_id IS NOT NULL
       AND fe.detected_at::date >= ${fromIdx}
       AND fe.detected_at::date <= ${toIdx}
     GROUP BY fe.detected_at::date
     ORDER BY fe.detected_at::date DESC`,
    params
  );

  // If no person_id data, fall back to daily_visitors table (legacy)
  if (rows.length === 0) {
    const { rows: fallback } = await pool.query(
      `SELECT dv.visit_date, SUM(dv.count) AS total_visitors,
              json_agg(json_build_object('camera_id', dv.camera_id, 'camera_name', c.name, 'count', dv.count)) AS by_camera
       FROM daily_visitors dv
       JOIN cameras c ON c.id = dv.camera_id
       WHERE ${cameraFilter}
         AND dv.visit_date >= ${fromIdx}
         AND dv.visit_date <= ${toIdx}
       GROUP BY dv.visit_date
       ORDER BY dv.visit_date DESC`,
      params
    );
    return fallback;
  }

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
