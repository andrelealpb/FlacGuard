import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, authorize } from '../services/auth.js';
import {
  embedPhoto,
  searchFace,
  isFaceServiceHealthy,
  countDistinctVisitors,
  getVisitorsByPdv,
} from '../services/face-recognition.js';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const router = Router();
const WATCHLIST_DIR = '/data/recordings/watchlist';

// Ensure directory exists
if (!existsSync(WATCHLIST_DIR)) {
  try { mkdirSync(WATCHLIST_DIR, { recursive: true }); } catch { /* ok */ }
}

// ─── Face Search ───

// POST /api/faces/search — Upload a photo and find where this person appeared
router.post('/search', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { photo, min_similarity, limit, camera_ids, from, to, reason } = req.body;

    if (!photo) {
      return res.status(400).json({ error: 'Photo (base64) is required' });
    }

    // Decode base64 photo
    const photoBuffer = Buffer.from(photo, 'base64');

    // Get embedding from face service
    const { embedding, confidence } = await embedPhoto(photoBuffer);

    // Search database
    const results = await searchFace(embedding, {
      limit: limit || 50,
      minSimilarity: min_similarity || 0.45,
      cameraIds: camera_ids,
      from,
      to,
    });

    // Audit log (LGPD)
    const userId = req.auth?.user?.id;
    if (userId) {
      await pool.query(
        'INSERT INTO face_search_log (user_id, reason, results) VALUES ($1, $2, $3)',
        [userId, reason || null, results.length]
      );
    }

    // Convert face_image paths to URLs
    const appearances = results.map((r) => ({
      id: r.id,
      camera_id: r.camera_id,
      camera_name: r.camera_name,
      pdv_id: r.pdv_id,
      pdv_name: r.pdv_name,
      similarity: parseFloat(r.similarity.toFixed(3)),
      confidence: r.confidence,
      detected_at: r.detected_at,
      face_image: r.face_image ? `/api/faces/image?path=${encodeURIComponent(r.face_image)}` : null,
    }));

    // Group appearances by distinct time moments (within 5 min on the same camera = same visit)
    const TIME_GAP_MS = 5 * 60 * 1000;
    const grouped = [];
    // Sort by camera then by time for grouping
    const sorted = [...appearances].sort((a, b) => {
      if (a.camera_id !== b.camera_id) return a.camera_id.localeCompare(b.camera_id);
      return new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime();
    });

    for (const app of sorted) {
      const t = new Date(app.detected_at).getTime();
      const existing = grouped.find(
        (g) => g.camera_id === app.camera_id && Math.abs(t - new Date(g.last_seen).getTime()) <= TIME_GAP_MS
      );
      if (existing) {
        existing.detections++;
        // Update time range
        if (t < new Date(existing.first_seen).getTime()) existing.first_seen = app.detected_at;
        if (t > new Date(existing.last_seen).getTime()) existing.last_seen = app.detected_at;
        // Keep the best match as representative
        if (app.similarity > existing.similarity) {
          existing.id = app.id;
          existing.similarity = app.similarity;
          existing.confidence = app.confidence;
          existing.face_image = app.face_image;
        }
      } else {
        grouped.push({
          ...app,
          first_seen: app.detected_at,
          last_seen: app.detected_at,
          detections: 1,
        });
      }
    }

    // Sort grouped results by most recent first
    grouped.sort((a, b) => new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime());

    res.json({
      query_confidence: confidence,
      total: grouped.length,
      total_raw: appearances.length,
      appearances: grouped,
    });
  } catch (err) {
    console.error('[Faces] Search error:', err.message);
    if (err.message.includes('No face detected')) {
      return res.status(400).json({ error: 'Nenhum rosto detectado na foto enviada' });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/faces/image — Serve a face crop image (internal path)
router.get('/image', authenticate, (req, res) => {
  const { path } = req.query;
  if (!path || !path.startsWith('/data/recordings/')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!existsSync(path)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(path);
});

// GET /api/faces/status — Check if face recognition is operational
router.get('/status', authenticate, async (_req, res) => {
  const healthy = await isFaceServiceHealthy();
  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM face_embeddings');
  const { rows: wl } = await pool.query('SELECT COUNT(*) AS total FROM face_watchlist WHERE is_active = true');

  res.json({
    service_available: healthy,
    total_embeddings: parseInt(rows[0].total),
    active_watchlist: parseInt(wl[0].total),
  });
});

// ─── Watchlist ───

// GET /api/faces/watchlist — List all watchlist entries
router.get('/watchlist', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description, photo_path, alert_type, is_active, created_at, updated_at
       FROM face_watchlist
       ORDER BY created_at DESC`
    );

    const entries = rows.map((r) => ({
      ...r,
      photo_url: r.photo_path ? `/api/faces/image?path=${encodeURIComponent(r.photo_path)}` : null,
    }));

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/watchlist — Add a person to the watchlist
router.post('/watchlist', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, description, photo, alert_type } = req.body;

    if (!name || !photo) {
      return res.status(400).json({ error: 'Name and photo (base64) are required' });
    }

    const photoBuffer = Buffer.from(photo, 'base64');

    // Get embedding
    const { embedding, confidence } = await embedPhoto(photoBuffer);

    // Save photo
    const filename = `watchlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const photoPath = join(WATCHLIST_DIR, filename);
    writeFileSync(photoPath, photoBuffer);

    const embeddingStr = `[${embedding.join(',')}]`;
    const userId = req.auth?.user?.id || null;

    const { rows } = await pool.query(
      `INSERT INTO face_watchlist (name, description, photo_path, embedding, alert_type, created_by)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       RETURNING id, name, description, alert_type, created_at`,
      [name, description || null, photoPath, embeddingStr, alert_type || 'suspect', userId]
    );

    console.log(`[Face] Watchlist entry added: "${name}" (${alert_type || 'suspect'}) — confidence ${(confidence * 100).toFixed(1)}%`);

    res.status(201).json({
      ...rows[0],
      photo_url: `/api/faces/image?path=${encodeURIComponent(photoPath)}`,
    });
  } catch (err) {
    console.error('[Faces] Watchlist add error:', err.message);
    if (err.message.includes('No face detected')) {
      return res.status(400).json({ error: 'Nenhum rosto detectado na foto enviada' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/watchlist/from-appearance — Add face to watchlist from a face_embeddings crop
router.post('/watchlist/from-appearance', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { face_embedding_id, name, description, alert_type } = req.body;
    if (!face_embedding_id) {
      return res.status(400).json({ error: 'face_embedding_id is required' });
    }

    // Get the face embedding and crop path from DB
    const { rows } = await pool.query(
      'SELECT embedding, face_image, confidence FROM face_embeddings WHERE id = $1',
      [face_embedding_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Face embedding not found' });

    const { embedding, face_image, confidence } = rows[0];
    if (!face_image || !existsSync(face_image)) {
      return res.status(400).json({ error: 'Crop image not found on disk' });
    }

    // Copy crop to watchlist directory
    const photoBuffer = readFileSync(face_image);
    const filename = `watchlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const photoPath = join(WATCHLIST_DIR, filename);
    if (!existsSync(WATCHLIST_DIR)) mkdirSync(WATCHLIST_DIR, { recursive: true });
    writeFileSync(photoPath, photoBuffer);

    // Re-serialize embedding from pgvector format
    const embeddingStr = typeof embedding === 'string' ? embedding : `[${embedding.join(',')}]`;
    const userId = req.auth?.user?.id || null;
    const entryName = name || `Suspeito ${new Date().toLocaleDateString('pt-BR')}`;

    const { rows: inserted } = await pool.query(
      `INSERT INTO face_watchlist (name, description, photo_path, embedding, alert_type, created_by)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       RETURNING id, name, description, alert_type, created_at`,
      [entryName, description || null, photoPath, embeddingStr, alert_type || 'suspect', userId]
    );

    console.log(`[Face] Watchlist entry added from appearance: "${entryName}" (${alert_type || 'suspect'}) — confidence ${(confidence * 100).toFixed(1)}%`);

    res.status(201).json({
      ...inserted[0],
      photo_url: `/api/faces/image?path=${encodeURIComponent(photoPath)}`,
    });
  } catch (err) {
    console.error('[Faces] Watchlist from appearance error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/faces/watchlist/:id — Update watchlist entry
router.patch('/watchlist/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, alert_type, is_active } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (alert_type !== undefined) { updates.push(`alert_type = $${idx++}`); values.push(alert_type); }
    if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE face_watchlist SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Watchlist entry not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/faces/watchlist/:id — Remove from watchlist
router.delete('/watchlist/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      'DELETE FROM face_watchlist WHERE id = $1 RETURNING id, photo_path',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Watchlist entry not found' });
    }

    // Delete photo file
    if (rows[0].photo_path && existsSync(rows[0].photo_path)) {
      try { unlinkSync(rows[0].photo_path); } catch { /* ok */ }
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Persons ───

const PERSONS_DIR = '/data/recordings/persons';
if (!existsSync(PERSONS_DIR)) {
  try { mkdirSync(PERSONS_DIR, { recursive: true }); } catch { /* ok */ }
}

// GET /api/faces/persons — List all persons
router.get('/persons', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM face_embeddings fe WHERE fe.person_id = p.id) AS embedding_count,
        (SELECT fw.id FROM face_watchlist fw WHERE fw.person_id = p.id AND fw.is_active = true LIMIT 1) AS watchlist_id,
        (SELECT fw.alert_type FROM face_watchlist fw WHERE fw.person_id = p.id AND fw.is_active = true LIMIT 1) AS alert_type
      FROM persons p
      ORDER BY p.updated_at DESC
    `);
    res.json(rows.map((r) => ({
      ...r,
      embedding_count: parseInt(r.embedding_count),
      photo_url: r.photo_path ? `/api/faces/image?path=${encodeURIComponent(r.photo_path)}` : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/faces/persons/:id — Get person details with embeddings
router.get('/persons/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM persons WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Person not found' });

    const person = rows[0];
    person.photo_url = person.photo_path ? `/api/faces/image?path=${encodeURIComponent(person.photo_path)}` : null;

    // Get all linked embeddings (distinct face appearances)
    const { rows: embeddings } = await pool.query(`
      SELECT fe.id, fe.camera_id, fe.face_image, fe.confidence, fe.detected_at,
             c.name AS camera_name, p.name AS pdv_name
      FROM face_embeddings fe
      JOIN cameras c ON c.id = fe.camera_id
      JOIN pdvs p ON p.id = c.pdv_id
      WHERE fe.person_id = $1
      ORDER BY fe.detected_at DESC
    `, [req.params.id]);

    person.embeddings = embeddings.map((e) => ({
      ...e,
      face_image: e.face_image ? `/api/faces/image?path=${encodeURIComponent(e.face_image)}` : null,
    }));

    // Get watchlist link if any
    const { rows: wl } = await pool.query(
      'SELECT id, name, alert_type, is_active FROM face_watchlist WHERE person_id = $1',
      [req.params.id]
    );
    person.watchlist = wl[0] || null;

    res.json(person);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/persons — Create a person from face embedding IDs
router.post('/persons', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, description, face_embedding_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!face_embedding_ids || !Array.isArray(face_embedding_ids) || face_embedding_ids.length === 0) {
      return res.status(400).json({ error: 'face_embedding_ids array is required (at least 1)' });
    }

    const userId = req.auth?.user?.id || null;

    // Get the best face crop as representative photo (highest confidence)
    const { rows: bestFace } = await pool.query(`
      SELECT face_image, confidence FROM face_embeddings
      WHERE id = ANY($1) AND face_image IS NOT NULL
      ORDER BY confidence DESC LIMIT 1
    `, [face_embedding_ids]);

    let photoPath = null;
    if (bestFace.length > 0 && bestFace[0].face_image && existsSync(bestFace[0].face_image)) {
      const filename = `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      photoPath = join(PERSONS_DIR, filename);
      writeFileSync(photoPath, readFileSync(bestFace[0].face_image));
    }

    // Create person
    const { rows: inserted } = await pool.query(
      `INSERT INTO persons (name, description, photo_path, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, photoPath, userId]
    );
    const person = inserted[0];

    // Link all selected embeddings to this person
    await pool.query(
      'UPDATE face_embeddings SET person_id = $1 WHERE id = ANY($2)',
      [person.id, face_embedding_ids]
    );

    // Also link any other embeddings that share the same auto-generated person_id
    // (i.e., embeddings the system already grouped as same person)
    const { rows: linkedPersonIds } = await pool.query(
      'SELECT DISTINCT person_id FROM face_embeddings WHERE id = ANY($1) AND person_id IS NOT NULL',
      [face_embedding_ids]
    );
    if (linkedPersonIds.length > 0) {
      const oldPersonIds = linkedPersonIds.map(r => r.person_id).filter(pid => pid !== person.id);
      if (oldPersonIds.length > 0) {
        await pool.query(
          'UPDATE face_embeddings SET person_id = $1 WHERE person_id = ANY($2)',
          [person.id, oldPersonIds]
        );
      }
    }

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM face_embeddings WHERE person_id = $1',
      [person.id]
    );

    console.log(`[Face] Person created: "${name}" with ${countRows[0].total} embeddings`);

    res.status(201).json({
      ...person,
      photo_url: photoPath ? `/api/faces/image?path=${encodeURIComponent(photoPath)}` : null,
      embedding_count: parseInt(countRows[0].total),
    });
  } catch (err) {
    console.error('[Faces] Person create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/persons/from-embedding — Create a person from a single embedding (auto-finds all related)
router.post('/persons/from-embedding', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, description, embedding, min_similarity = 0.55 } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: 'embedding array is required' });
    }

    const userId = req.auth?.user?.id || null;
    const embeddingStr = `[${embedding.join(',')}]`;

    // Find all similar embeddings in the database
    const { rows: matches } = await pool.query(`
      SELECT id, face_image, confidence, detected_at,
             1 - (embedding <=> $1::vector) AS similarity
      FROM face_embeddings
      WHERE 1 - (embedding <=> $1::vector) >= $2
      ORDER BY detected_at DESC
    `, [embeddingStr, min_similarity]);

    if (matches.length === 0) {
      return res.status(400).json({ error: 'Nenhum embedding similar encontrado' });
    }

    // Use best confidence face as representative photo
    const bestFace = [...matches].sort((a, b) => b.confidence - a.confidence)[0];
    let photoPath = null;
    if (bestFace.face_image && existsSync(bestFace.face_image)) {
      const filename = `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      photoPath = join(PERSONS_DIR, filename);
      writeFileSync(photoPath, readFileSync(bestFace.face_image));
    }

    // Create person
    const { rows: inserted } = await pool.query(
      `INSERT INTO persons (name, description, photo_path, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description || null, photoPath, userId]
    );
    const person = inserted[0];

    // Link all matching embeddings
    const matchIds = matches.map(m => m.id);
    await pool.query(
      'UPDATE face_embeddings SET person_id = $1 WHERE id = ANY($2)',
      [person.id, matchIds]
    );

    console.log(`[Face] Person created from embedding: "${name}" with ${matches.length} embeddings`);

    res.status(201).json({
      ...person,
      photo_url: photoPath ? `/api/faces/image?path=${encodeURIComponent(photoPath)}` : null,
      embedding_count: matches.length,
    });
  } catch (err) {
    console.error('[Faces] Person from embedding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/faces/persons/:id — Update person details
router.patch('/persons/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = now()');
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE persons SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Person not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/persons/:id/add-embeddings — Add more embeddings to a person
router.post('/persons/:id/add-embeddings', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { face_embedding_ids } = req.body;
    if (!face_embedding_ids || !Array.isArray(face_embedding_ids) || face_embedding_ids.length === 0) {
      return res.status(400).json({ error: 'face_embedding_ids array is required' });
    }

    // Verify person exists
    const { rows: person } = await pool.query('SELECT id FROM persons WHERE id = $1', [req.params.id]);
    if (person.length === 0) return res.status(404).json({ error: 'Person not found' });

    await pool.query(
      'UPDATE face_embeddings SET person_id = $1 WHERE id = ANY($2)',
      [req.params.id, face_embedding_ids]
    );

    await pool.query('UPDATE persons SET updated_at = now() WHERE id = $1', [req.params.id]);

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM face_embeddings WHERE person_id = $1',
      [req.params.id]
    );

    res.json({ embedding_count: parseInt(countRows[0].total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/persons/:id/search — Search using all embeddings of a person (multi-embedding search)
router.post('/persons/:id/search', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { limit = 50, min_similarity = 0.45, camera_ids, from, to } = req.body;

    // Get all embeddings for this person
    const { rows: personEmbeddings } = await pool.query(
      'SELECT embedding FROM face_embeddings WHERE person_id = $1',
      [req.params.id]
    );
    if (personEmbeddings.length === 0) {
      return res.status(400).json({ error: 'Person has no embeddings' });
    }

    // Search with each embedding and merge results (take best similarity per match)
    const allResults = new Map();
    for (const pe of personEmbeddings) {
      const embeddingArr = typeof pe.embedding === 'string'
        ? pe.embedding.replace(/[\[\]]/g, '').split(',').map(Number)
        : pe.embedding;
      const results = await searchFace(embeddingArr, {
        limit: limit * 2, // fetch more to account for dedup
        minSimilarity: min_similarity,
        cameraIds: camera_ids,
        from,
        to,
      });
      for (const r of results) {
        const existing = allResults.get(r.id);
        if (!existing || parseFloat(r.similarity) > parseFloat(existing.similarity)) {
          allResults.set(r.id, r);
        }
      }
    }

    // Convert to array, sort by date DESC
    const results = Array.from(allResults.values())
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
      .slice(0, limit);

    const appearances = results.map((r) => ({
      id: r.id,
      camera_id: r.camera_id,
      camera_name: r.camera_name,
      pdv_id: r.pdv_id,
      pdv_name: r.pdv_name,
      similarity: parseFloat(parseFloat(r.similarity).toFixed(3)),
      confidence: r.confidence,
      detected_at: r.detected_at,
      face_image: r.face_image ? `/api/faces/image?path=${encodeURIComponent(r.face_image)}` : null,
    }));

    // Group by 5-min windows
    const TIME_GAP_MS = 5 * 60 * 1000;
    const grouped = [];
    const sortedForGrouping = [...appearances].sort((a, b) => {
      if (a.camera_id !== b.camera_id) return a.camera_id.localeCompare(b.camera_id);
      return new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime();
    });

    for (const app of sortedForGrouping) {
      const t = new Date(app.detected_at).getTime();
      const existing = grouped.find(
        (g) => g.camera_id === app.camera_id && Math.abs(t - new Date(g.last_seen).getTime()) <= TIME_GAP_MS
      );
      if (existing) {
        existing.detections++;
        if (t < new Date(existing.first_seen).getTime()) existing.first_seen = app.detected_at;
        if (t > new Date(existing.last_seen).getTime()) existing.last_seen = app.detected_at;
        if (app.similarity > existing.similarity) {
          existing.id = app.id;
          existing.similarity = app.similarity;
          existing.confidence = app.confidence;
          existing.face_image = app.face_image;
        }
      } else {
        grouped.push({ ...app, first_seen: app.detected_at, last_seen: app.detected_at, detections: 1 });
      }
    }

    grouped.sort((a, b) => new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime());

    // Audit log
    const userId = req.auth?.user?.id;
    if (userId) {
      await pool.query(
        'INSERT INTO face_search_log (user_id, reason, results) VALUES ($1, $2, $3)',
        [userId, `person-search:${req.params.id}`, grouped.length]
      );
    }

    res.json({ total: grouped.length, total_raw: appearances.length, appearances: grouped });
  } catch (err) {
    console.error('[Faces] Person search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/faces/persons/:id — Delete a person (unlinks embeddings, does not delete them)
router.delete('/persons/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    // Unlink embeddings (don't delete them — they're still useful for search)
    await pool.query(
      'UPDATE face_embeddings SET person_id = NULL WHERE person_id = $1',
      [req.params.id]
    );

    // Unlink from watchlist
    await pool.query(
      'UPDATE face_watchlist SET person_id = NULL WHERE person_id = $1',
      [req.params.id]
    );

    const { rows } = await pool.query(
      'DELETE FROM persons WHERE id = $1 RETURNING id, photo_path',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Person not found' });

    if (rows[0].photo_path && existsSync(rows[0].photo_path)) {
      try { unlinkSync(rows[0].photo_path); } catch { /* ok */ }
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/persons/:id/watchlist — Add person to watchlist (uses all their embeddings)
router.post('/persons/:id/watchlist', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { alert_type = 'suspect' } = req.body;

    const { rows: person } = await pool.query('SELECT * FROM persons WHERE id = $1', [req.params.id]);
    if (person.length === 0) return res.status(404).json({ error: 'Person not found' });

    // Check if already on watchlist
    const { rows: existing } = await pool.query(
      'SELECT id FROM face_watchlist WHERE person_id = $1',
      [req.params.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Person already on watchlist', watchlist_id: existing[0].id });
    }

    // Get a representative embedding (best confidence)
    const { rows: bestEmb } = await pool.query(`
      SELECT embedding, confidence FROM face_embeddings
      WHERE person_id = $1 ORDER BY confidence DESC LIMIT 1
    `, [req.params.id]);

    if (bestEmb.length === 0) {
      return res.status(400).json({ error: 'Person has no embeddings' });
    }

    const embeddingStr = typeof bestEmb[0].embedding === 'string'
      ? bestEmb[0].embedding
      : `[${bestEmb[0].embedding.join(',')}]`;
    const userId = req.auth?.user?.id || null;
    const photoPath = person[0].photo_path;

    const { rows: inserted } = await pool.query(
      `INSERT INTO face_watchlist (name, description, photo_path, embedding, alert_type, person_id, created_by)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
       RETURNING id, name, alert_type, created_at`,
      [person[0].name, person[0].description, photoPath, embeddingStr, alert_type, req.params.id, userId]
    );

    console.log(`[Face] Person "${person[0].name}" added to watchlist as ${alert_type}`);

    res.status(201).json(inserted[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Alerts ───

// GET /api/faces/alerts — List face alerts
router.get('/alerts', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { acknowledged, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT fa.*, fw.name AS watchlist_name, fw.alert_type,
             c.name AS camera_name, p.name AS pdv_name
      FROM face_alerts fa
      JOIN face_watchlist fw ON fw.id = fa.watchlist_id
      JOIN cameras c ON c.id = fa.camera_id
      JOIN pdvs p ON p.id = c.pdv_id
    `;
    const params = [];
    let idx = 1;

    if (acknowledged !== undefined) {
      query += ` WHERE fa.acknowledged = $${idx++}`;
      params.push(acknowledged === 'true');
    }

    query += ` ORDER BY fa.created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/faces/alerts/:id/acknowledge — Acknowledge an alert
router.patch('/alerts/:id/acknowledge', authenticate, authorize('admin'), async (req, res) => {
  try {
    const userId = req.auth?.user?.id || null;
    const { rows } = await pool.query(
      `UPDATE face_alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = now()
       WHERE id = $2 RETURNING *`,
      [userId, req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Visitors ───

// GET /api/faces/visitors/compute — Trigger visitor count computation for a date
router.post('/visitors/compute', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { camera_id, date } = req.body;
    if (!camera_id || !date) {
      return res.status(400).json({ error: 'camera_id and date are required' });
    }

    const count = await countDistinctVisitors(camera_id, date);
    res.json({ camera_id, date, distinct_visitors: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/faces/reimport — Rebuild face_embeddings from existing crop files on disk
const FACE_DIR = '/data/recordings/faces';
const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://face-service:8001';
const VISITOR_THRESHOLD = 0.65;

let reimportRunning = false;
let reimportProgress = { imported: 0, skipped: 0, errors: 0, total: 0, done: false };

router.post('/reimport', authenticate, authorize('admin'), async (_req, res) => {
  if (reimportRunning) {
    return res.status(409).json({ error: 'Reimportação já está em andamento' });
  }

  reimportRunning = true;

  try {
    if (!existsSync(FACE_DIR)) {
      reimportRunning = false;
      return res.status(404).json({ error: 'Diretório de faces não encontrado' });
    }

    const files = readdirSync(FACE_DIR).filter(f => f.startsWith('face-') && f.endsWith('.jpg')).sort();
    if (files.length === 0) {
      reimportRunning = false;
      return res.json({ message: 'Nenhum crop encontrado', imported: 0, skipped: 0, errors: 0 });
    }

    // Get all cameras for timestamp matching
    const { rows: cameras } = await pool.query('SELECT id, name FROM cameras');
    if (cameras.length === 0) {
      reimportRunning = false;
      return res.status(400).json({ error: 'Nenhuma câmera cadastrada' });
    }

    // Respond immediately — reimport runs in background
    res.json({ message: `Reimportação iniciada para ${files.length} crops. Acompanhe os logs do servidor.`, total_files: files.length });

    let imported = 0, skipped = 0, errors = 0;
    reimportProgress = { imported: 0, skipped: 0, errors: 0, total: files.length, done: false };
    console.log(`[reimport] Starting reimport of ${files.length} face crops...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Extract timestamp from filename: face-{timestamp}-{random}.jpg
        const match = file.match(/^face-(\d+)-/);
        if (!match) { skipped++; continue; }

        const fileTimestamp = parseInt(match[1], 10);
        const detectedAt = new Date(fileTimestamp);
        const filePath = join(FACE_DIR, file);

        // Check if this crop is already in the database
        const { rows: existing } = await pool.query(
          'SELECT id FROM face_embeddings WHERE face_image = $1 LIMIT 1', [filePath]
        );
        if (existing.length > 0) { skipped++; continue; }

        // Read crop and send to embed service
        const jpegBuffer = readFileSync(filePath);
        const formData = new FormData();
        formData.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'photo.jpg');

        const embedRes = await fetch(`${FACE_SERVICE_URL}/embed`, { method: 'POST', body: formData });
        if (!embedRes.ok) { skipped++; continue; } // No face found or service error

        const { embedding, confidence } = await embedRes.json();
        if (!embedding || confidence < 0.35) { skipped++; continue; }

        // Find which camera had a recording at this timestamp
        const { rows: recMatch } = await pool.query(
          `SELECT camera_id FROM recordings
           WHERE started_at <= $1 AND (ended_at >= $1 OR ended_at IS NULL)
           ORDER BY started_at DESC LIMIT 1`,
          [detectedAt]
        );
        const cameraId = recMatch.length > 0 ? recMatch[0].camera_id : cameras[0].id;

        // Person linking: find existing person by embedding similarity
        const embeddingStr = `[${embedding.join(',')}]`;
        let personId = null;
        try {
          const { rows: matches } = await pool.query(
            `SELECT person_id, 1 - (embedding <=> $1::vector) AS similarity
             FROM face_embeddings
             WHERE person_id IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT 1`,
            [embeddingStr]
          );
          if (matches.length > 0 && matches[0].similarity >= VISITOR_THRESHOLD) {
            personId = matches[0].person_id;
          }
        } catch { /* continue without linking */ }

        if (!personId) {
          const { rows: uuidRows } = await pool.query('SELECT uuid_generate_v4() AS id');
          personId = uuidRows[0].id;
        }

        // Insert into face_embeddings
        await pool.query(
          `INSERT INTO face_embeddings (camera_id, embedding, face_image, confidence, detected_at, person_id)
           VALUES ($1, $2::vector, $3, $4, $5, $6)`,
          [cameraId, embeddingStr, filePath, confidence, detectedAt, personId]
        );

        imported++;
        reimportProgress = { imported, skipped, errors, total: files.length, done: false };
        if (imported % 10 === 0) {
          console.log(`[reimport] Progress: ${imported} imported, ${skipped} skipped, ${errors} errors (${i + 1}/${files.length})`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) console.error(`[reimport] Error processing ${file}:`, err.message);
      }
    }

    reimportProgress = { imported, skipped, errors, total: files.length, done: true };
    console.log(`[reimport] Complete: ${imported} imported, ${skipped} skipped, ${errors} errors out of ${files.length} files`);
    reimportRunning = false;
  } catch (err) {
    console.error('[reimport] Fatal error:', err);
    reimportProgress = { ...reimportProgress, done: true };
    reimportRunning = false;
  }
});

// GET /api/faces/reimport/status — Check reimport progress
router.get('/reimport/status', authenticate, async (_req, res) => {
  const { rows } = await pool.query('SELECT count(*) AS total FROM face_embeddings');
  res.json({ running: reimportRunning, total_embeddings: parseInt(rows[0].total, 10), progress: reimportProgress });
});

export default router;
