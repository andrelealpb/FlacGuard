import { pool } from '../db/pool.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { faceInPersonRatio, onFaceAttached } from './track-manager.js';

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://face-service:8001';
const FACE_DIR = '/data/recordings/faces';
const SIMILARITY_THRESHOLD = 0.85; // Watchlist alert threshold
const VISITOR_THRESHOLD = 0.65;    // Same-person threshold for visitor dedup (lowered to reduce over-counting)
const MIN_EMBEDDING_CONFIDENCE = 0.35; // Minimum detection confidence to store embedding for search
const MIN_QUALITY_SCORE = 0.45;    // Minimum quality score (landmarks + size + confidence) to store embedding

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
 * Track persons across frames using ByteTrack (one tracker per camera).
 * Returns stable tracker_id per person, allowing us to group all detections
 * of the same physical person into a single visitor count.
 * Returns { persons: [{ bbox, confidence, tracker_id }], count }
 */
export async function trackPersons(jpegBuffer, cameraId) {
  const formData = new FormData();
  formData.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'frame.jpg');
  formData.append('camera_id', cameraId);

  const res = await fetch(`${FACE_SERVICE_URL}/track-persons`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Person tracking failed (${res.status}): ${text}`);
  }

  return await res.json();
}

/**
 * Reset the ByteTrack state for a camera (called when camera goes offline
 * so stale tracks don't carry over when it comes back online).
 */
export async function resetTracker(cameraId) {
  const formData = new FormData();
  formData.append('camera_id', cameraId);

  try {
    await fetch(`${FACE_SERVICE_URL}/track-reset`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Best-effort: if face-service is down, the tracker state is lost anyway
  }
}

/**
 * Store detected face embeddings in database.
 * Links identical faces to the same person_id while keeping all captures
 * for better search accuracy. Uses vector similarity to find matching persons.
 *
 * If `trackedPersons` is provided (array of { tracker_id, bbox, track_uuid }
 * from track-manager), each face is also linked to the best matching track
 * via IoU, populating face_embeddings.track_id.
 */
export async function storeFaceEmbeddings(cameraId, faces, detectedAt, trackedPersons = []) {
  const ids = [];

  for (const face of faces) {
    // Skip low-quality detections — back-of-head, top-of-head, ears, tiny faces
    // produce noisy embeddings that hurt search accuracy and inflate visitor counts.
    // quality_score combines landmark visibility, face size, and detection confidence.
    const quality = face.quality_score ?? null;
    if (quality !== null) {
      if (quality < MIN_QUALITY_SCORE) continue;
    } else {
      // Fallback for face-service without quality_score (backwards compat)
      if (face.confidence < MIN_EMBEDDING_CONFIDENCE) continue;
    }

    // Save face crop image
    let facePath = null;
    let faceFileSize = null;
    if (face.face_image_b64) {
      const filename = `face-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      facePath = join(FACE_DIR, filename);
      try {
        const buf = Buffer.from(face.face_image_b64, 'base64');
        writeFileSync(facePath, buf);
        faceFileSize = buf.length;
      } catch {
        facePath = null;
        faceFileSize = null;
      }
    }

    // Serialize embedding as pgvector format
    const embeddingStr = `[${face.embedding.join(',')}]`;

    // Find the best matching active track (via IoU with person bbox)
    let matchedTrack = null;
    if (trackedPersons && trackedPersons.length > 0 && face.bbox) {
      let bestRatio = 0.3; // mesmo threshold do track-manager
      for (const tp of trackedPersons) {
        const ratio = faceInPersonRatio(face.bbox, tp.bbox);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          matchedTrack = tp;
        }
      }
    }

    // Find an existing person_id by matching against recent embeddings (last 30 days)
    // Uses pgvector HNSW index for fast similarity search
    let personId = null;
    let skipStore = false;
    try {
      const { rows: matches } = await pool.query(
        `SELECT person_id, 1 - (embedding <=> $1::vector) AS similarity, camera_id, detected_at
         FROM face_embeddings
         WHERE person_id IS NOT NULL
           AND detected_at > now() - interval '30 days'
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        [embeddingStr]
      );

      if (matches.length > 0 && matches[0].similarity >= VISITOR_THRESHOLD) {
        personId = matches[0].person_id;

        // Temporal dedup: skip storing if same person detected on same camera within last 30s
        if (matches[0].camera_id === cameraId) {
          const lastDetected = new Date(matches[0].detected_at).getTime();
          const now = (detectedAt || new Date()).getTime();
          if (Math.abs(now - lastDetected) < 30000) {
            skipStore = true;
          }
        }
      }
    } catch {
      // If person matching fails, continue without linking
    }

    if (skipStore) continue;

    // Generate new person_id if no match found
    if (!personId) {
      const { rows: uuidRows } = await pool.query('SELECT uuid_generate_v4() AS id');
      personId = uuidRows[0].id;
    }

    const trackUuid = matchedTrack ? matchedTrack.track_uuid : null;

    const { rows } = await pool.query(
      `INSERT INTO face_embeddings (camera_id, embedding, face_image, confidence, detected_at, person_id, track_id, file_size)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [cameraId, embeddingStr, facePath, quality ?? face.confidence, detectedAt || new Date(), personId, trackUuid, faceFileSize]
    );

    ids.push(rows[0].id);

    // Notify the track manager so it can update the "best frame" of the track
    if (matchedTrack) {
      onFaceAttached(cameraId, trackUuid, quality ?? 0, embeddingStr, facePath, null);
    }
  }

  return ids;
}

/**
 * Check detected faces against the active watchlist.
 * Returns matches: [{ watchlist_id, face_embedding_id, similarity, watchlist_entry }]
 */
export async function checkWatchlist(cameraId, faceEmbeddingIds) {
  const matches = [];

  // Get active watchlist entries (with optional person_id for multi-embedding matching)
  const { rows: watchlist } = await pool.query(
    'SELECT id, name, alert_type, embedding, person_id FROM face_watchlist WHERE is_active = true'
  );

  if (watchlist.length === 0) return matches;

  // Pre-fetch person embeddings for watchlist entries linked to a person
  const personEmbeddings = new Map();
  for (const entry of watchlist) {
    if (entry.person_id) {
      const { rows: pEmbs } = await pool.query(
        'SELECT embedding FROM face_embeddings WHERE person_id = $1',
        [entry.person_id]
      );
      if (pEmbs.length > 0) {
        personEmbeddings.set(entry.id, pEmbs);
      }
    }
  }

  for (const embId of faceEmbeddingIds) {
    for (const entry of watchlist) {
      let bestSimilarity = 0;

      if (personEmbeddings.has(entry.id)) {
        // Multi-embedding matching: compare against ALL embeddings of the person
        // Use the best (highest) similarity score
        const pEmbs = personEmbeddings.get(entry.id);
        for (const pEmb of pEmbs) {
          const embStr = typeof pEmb.embedding === 'string' ? pEmb.embedding : `[${pEmb.embedding.join(',')}]`;
          const { rows } = await pool.query(
            `SELECT 1 - (fe.embedding <=> $2::vector) AS similarity
             FROM face_embeddings fe WHERE fe.id = $1`,
            [embId, embStr]
          );
          if (rows.length > 0 && rows[0].similarity > bestSimilarity) {
            bestSimilarity = rows[0].similarity;
          }
        }
      } else {
        // Single embedding matching (legacy or no person linked)
        const { rows } = await pool.query(
          `SELECT 1 - (fe.embedding <=> fw.embedding) AS similarity
           FROM face_embeddings fe, face_watchlist fw
           WHERE fe.id = $1 AND fw.id = $2`,
          [embId, entry.id]
        );
        if (rows.length > 0) bestSimilarity = rows[0].similarity;
      }

      if (bestSimilarity >= SIMILARITY_THRESHOLD) {
        // Create alert
        const { rows: alertRows } = await pool.query(
          `INSERT INTO face_alerts (watchlist_id, face_embedding_id, camera_id, similarity)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [entry.id, embId, cameraId, bestSimilarity]
        );

        // Create event
        await pool.query(
          `INSERT INTO events (camera_id, type, payload)
           VALUES ($1, 'ai_alert', $2)`,
          [cameraId, JSON.stringify({
            alert_type: 'watchlist_match',
            watchlist_id: entry.id,
            watchlist_name: entry.name,
            similarity: parseFloat(bestSimilarity.toFixed(3)),
            face_alert_id: alertRows[0].id,
          })]
        );

        matches.push({
          watchlist_id: entry.id,
          face_embedding_id: embId,
          similarity: bestSimilarity,
          watchlist_entry: { id: entry.id, name: entry.name, alert_type: entry.alert_type },
        });

        console.log(`[Face] WATCHLIST MATCH: "${entry.name}" (${entry.alert_type}) on camera ${cameraId} — ${(bestSimilarity * 100).toFixed(1)}%`);
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
  const { limit = 50, minSimilarity = 0.45, cameraIds, pdvId, from, to } = options;
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
      AND fe.confidence >= ${MIN_QUALITY_SCORE}
  `;
  const params = [embeddingStr, minSimilarity];
  let paramIdx = 3;

  if (pdvId) {
    query += ` AND c.pdv_id = $${paramIdx}`;
    params.push(pdvId);
    paramIdx++;
  }

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

  query += ` ORDER BY fe.detected_at DESC LIMIT $${paramIdx}`;
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
 * Parse a pgvector string "[0.1,0.2,...]" into a Float32Array.
 * Embeddings are L2-normalized by the face-service, so cosine similarity
 * equals the dot product — no need to divide by norms.
 */
function parsePgVector(str) {
  if (!str) return null;
  const s = typeof str === 'string' ? str : String(str);
  const trimmed = s.startsWith('[') ? s.slice(1, -1) : s;
  const parts = trimmed.split(',');
  const arr = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) arr[i] = parseFloat(parts[i]);
  return arr;
}

function dotProduct(a, b) {
  let dot = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Greedy clustering: agrupa tracks cujos best_embeddings têm similaridade
 * acima do threshold. Retorna o número de clusters distintos.
 * Tracks devem vir ordenados por qualidade DESC (melhores viram representatives).
 */
function clusterTracks(tracks, threshold = 0.55) {
  const clusters = [];
  for (const t of tracks) {
    if (!t.embeddingArr) continue;
    let matched = false;
    for (const c of clusters) {
      if (dotProduct(t.embeddingArr, c.representative) >= threshold) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ representative: t.embeddingArr });
    }
  }
  return clusters.length;
}

/**
 * Get visitor counts over a date range using the tracking-based counting.
 * Each person_track = 1 physical person on 1 camera. Cross-camera dedup
 * within each PDV is done via greedy clustering of best_embeddings.
 *
 * Falls back to the legacy face_embeddings.person_id counting for dates
 * before person_tracks existed (preserves historical data).
 *
 * pdvIds: null (all) | string (one) | array of IDs.
 */
export async function getVisitorsByPdv(pdvIds, from, to) {
  // Normalize pdvIds
  let pdvFilter = '';
  const params = [from, to];
  if (pdvIds) {
    const ids = Array.isArray(pdvIds) ? pdvIds : [pdvIds];
    if (ids.length > 0) {
      params.push(ids);
      pdvFilter = `AND c.pdv_id = ANY($3)`;
    }
  }

  // Fetch all finalized tracks in the range with their best_embeddings.
  // Priority logic (same as before): if a PDV has face cameras with tracks
  // on a given day, only use those; otherwise fall back to all capture_face cameras.
  const { rows: trackRows } = await pool.query(
    `WITH day_priority AS (
       SELECT
         c.pdv_id,
         pt.started_at::date AS d,
         bool_or(c.camera_purpose = 'face') AS has_face_cameras
       FROM person_tracks pt
       JOIN cameras c ON c.id = pt.camera_id
       WHERE pt.ended_at IS NOT NULL
         AND pt.best_embedding IS NOT NULL
         AND pt.started_at::date >= $1
         AND pt.started_at::date <= $2
         AND c.capture_face = true
         ${pdvFilter}
       GROUP BY c.pdv_id, pt.started_at::date
     )
     SELECT
       pt.id AS track_id,
       c.pdv_id,
       p.name AS pdv_name,
       pt.started_at::date AS d,
       pt.best_quality_score,
       pt.best_embedding::text AS embedding_str
     FROM person_tracks pt
     JOIN cameras c ON c.id = pt.camera_id
     JOIN pdvs p ON p.id = c.pdv_id
     JOIN day_priority dp ON dp.pdv_id = c.pdv_id AND dp.d = pt.started_at::date
     WHERE pt.ended_at IS NOT NULL
       AND pt.best_embedding IS NOT NULL
       AND pt.started_at::date >= $1
       AND pt.started_at::date <= $2
       AND c.capture_face = true
       ${pdvFilter}
       AND (
         (dp.has_face_cameras = true AND c.camera_purpose = 'face')
         OR
         (dp.has_face_cameras = false)
       )
     ORDER BY c.pdv_id, pt.started_at::date, pt.best_quality_score DESC`,
    params
  );

  // Group tracks by (pdv_id, day) and run clustering per group
  const byDayPdv = new Map(); // key = "pdv_id|date" → { pdv_id, pdv_name, date, tracks: [] }

  for (const row of trackRows) {
    const dateStr = row.d instanceof Date
      ? row.d.toISOString().slice(0, 10)
      : String(row.d).slice(0, 10);
    const key = `${row.pdv_id}|${dateStr}`;
    let bucket = byDayPdv.get(key);
    if (!bucket) {
      bucket = { pdv_id: row.pdv_id, pdv_name: row.pdv_name, date: dateStr, tracks: [] };
      byDayPdv.set(key, bucket);
    }
    bucket.tracks.push({
      id: row.track_id,
      quality: row.best_quality_score,
      embeddingArr: parsePgVector(row.embedding_str),
    });
  }

  // Cluster each bucket and aggregate by day
  const byDate = new Map(); // date → { total: 0, by_pdv: [] }
  for (const bucket of byDayPdv.values()) {
    const count = clusterTracks(bucket.tracks, 0.55);
    let day = byDate.get(bucket.date);
    if (!day) {
      day = { visit_date: bucket.date, total_visitors: 0, by_pdv: [] };
      byDate.set(bucket.date, day);
    }
    day.total_visitors += count;
    day.by_pdv.push({ pdv_id: bucket.pdv_id, pdv_name: bucket.pdv_name, count });
  }

  const trackingResults = Array.from(byDate.values()).sort(
    (a, b) => b.visit_date.localeCompare(a.visit_date)
  );

  // If we have tracking results, use them
  if (trackingResults.length > 0) {
    return trackingResults;
  }

  // Fallback: legacy counting via face_embeddings.person_id (for historical dates)
  return getVisitorsByPdvLegacy(pdvIds, from, to);
}

/**
 * Legacy visitor counting (face_embeddings.person_id based).
 * Kept as fallback for dates before person_tracks were populated.
 */
async function getVisitorsByPdvLegacy(pdvIds, from, to) {
  // Normalize pdvIds: null = all, string = single, array = multiple
  let pdvFilter = '';
  const params = [from, to];
  if (pdvIds) {
    const ids = Array.isArray(pdvIds) ? pdvIds : [pdvIds];
    if (ids.length > 0) {
      params.push(ids);
      pdvFilter = `AND c.pdv_id = ANY($3)`;
    }
  }

  // Per-PDV visitor count using camera priority:
  // For each PDV+day, prefer face cameras. If no face cameras have data, use all cameras with capture_face.
  const { rows } = await pool.query(
    `WITH pdv_camera_priority AS (
       -- For each PDV, determine if face cameras have data for each day
       SELECT
         c.pdv_id,
         fe.detected_at::date AS d,
         bool_or(c.camera_purpose = 'face') AS has_face_cameras
       FROM face_embeddings fe
       JOIN cameras c ON c.id = fe.camera_id
       WHERE fe.person_id IS NOT NULL
         AND fe.detected_at::date >= $1
         AND fe.detected_at::date <= $2
         AND c.capture_face = true
         ${pdvFilter}
       GROUP BY c.pdv_id, fe.detected_at::date
     ),
     pdv_counts AS (
       -- Count distinct persons per PDV per day, respecting camera priority
       SELECT
         p.id AS pdv_id,
         p.name AS pdv_name,
         fe.detected_at::date AS d,
         COUNT(DISTINCT fe.person_id)::int AS pdv_count
       FROM face_embeddings fe
       JOIN cameras c ON c.id = fe.camera_id
       JOIN pdvs p ON p.id = c.pdv_id
       JOIN pdv_camera_priority pcp ON pcp.pdv_id = c.pdv_id AND pcp.d = fe.detected_at::date
       WHERE fe.person_id IS NOT NULL
         AND fe.detected_at::date >= $1
         AND fe.detected_at::date <= $2
         AND c.capture_face = true
         ${pdvFilter}
         -- If PDV has face cameras with data, only count from face cameras
         -- Otherwise, count from all cameras with capture_face=true
         AND (
           (pcp.has_face_cameras = true AND c.camera_purpose = 'face')
           OR
           (pcp.has_face_cameras = false)
         )
       GROUP BY p.id, p.name, fe.detected_at::date
     )
     SELECT
       to_char(pc.d, 'YYYY-MM-DD') AS visit_date,
       SUM(pc.pdv_count)::int AS total_visitors,
       json_agg(DISTINCT jsonb_build_object(
         'pdv_id', pc.pdv_id,
         'pdv_name', pc.pdv_name,
         'count', pc.pdv_count
       )) AS by_pdv
     FROM pdv_counts pc
     GROUP BY pc.d
     ORDER BY pc.d DESC`,
    params
  );

  // If no person_id data, fall back to daily_visitors table (legacy)
  if (rows.length === 0) {
    const pdvFilterDv = pdvFilter ? pdvFilter.replace('c.pdv_id', 'p.id') : '';
    const { rows: fallback } = await pool.query(
      `SELECT to_char(dv.visit_date, 'YYYY-MM-DD') AS visit_date,
              SUM(dv.count)::int AS total_visitors,
              json_agg(json_build_object('pdv_id', p.id, 'pdv_name', p.name, 'count', dv.count)) AS by_pdv
       FROM daily_visitors dv
       JOIN cameras c ON c.id = dv.camera_id
       JOIN pdvs p ON p.id = c.pdv_id
       WHERE dv.visit_date >= $1
         AND dv.visit_date <= $2
         ${pdvFilterDv}
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
