import { pool } from '../db/pool.js';
import { unlinkSync, existsSync } from 'fs';
import { deleteObject } from './storage.js';

/**
 * Delete recordings older than a specific camera's retention_days setting.
 * Called on-demand per camera, not automatically.
 */
export async function cleanupCamera(cameraId) {
  const { rows: cameras } = await pool.query(
    'SELECT id, name, retention_days FROM cameras WHERE id = $1',
    [cameraId]
  );
  if (cameras.length === 0) return { deleted: 0, freed: 0 };

  const camera = cameras[0];
  return await deleteOldRecordings(camera);
}

/**
 * Delete recordings older than retention period for all cameras.
 * Called on-demand via API endpoint.
 */
export async function cleanupAllCameras() {
  const { rows: cameras } = await pool.query(
    'SELECT id, name, retention_days FROM cameras'
  );

  let totalDeleted = 0;
  let totalFreed = 0;

  for (const camera of cameras) {
    const result = await deleteOldRecordings(camera);
    totalDeleted += result.deleted;
    totalFreed += result.freed;
  }

  if (totalDeleted > 0) {
    console.log(`[Cleanup] Deleted ${totalDeleted} old recordings, freed ${(totalFreed / 1024 / 1024 / 1024).toFixed(2)} GB`);
  }

  return { deleted: totalDeleted, freed: totalFreed };
}

async function deleteOldRecordings(camera) {
  let deleted = 0;
  let freed = 0;

  try {
    const { rows: oldRecordings } = await pool.query(
      `SELECT id, file_path, file_size, thumbnail_path, s3_key
       FROM recordings
       WHERE camera_id = $1
         AND started_at < now() - ($2 || ' days')::interval`,
      [camera.id, camera.retention_days]
    );

    for (const recording of oldRecordings) {
      try {
        // Delete from S3 if stored there
        if (recording.s3_key) {
          await deleteObject(recording.s3_key);
        }
        // Delete local file if exists
        if (recording.file_path && existsSync(recording.file_path)) {
          unlinkSync(recording.file_path);
        }
        if (recording.thumbnail_path && existsSync(recording.thumbnail_path)) {
          unlinkSync(recording.thumbnail_path);
        }
      } catch (err) {
        console.error(`[Cleanup] Error deleting file ${recording.file_path}:`, err.message);
      }

      await pool.query('DELETE FROM recordings WHERE id = $1', [recording.id]);

      deleted++;
      freed += recording.file_size || 0;
    }

    if (deleted > 0) {
      console.log(`[Cleanup] Camera ${camera.name}: deleted ${deleted} recordings, freed ${(freed / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (err) {
    console.error(`[Cleanup] Error cleaning camera ${camera.name}:`, err.message);
  }

  // Clean old face embeddings (same retention as recordings)
  // NOTE: Watchlist entries are NEVER auto-deleted (permanent)
  try {
    const { rows: oldFaces } = await pool.query(
      `SELECT id, face_image, face_image_s3_key
       FROM face_embeddings
       WHERE camera_id = $1
         AND detected_at < now() - ($2 || ' days')::interval`,
      [camera.id, camera.retention_days]
    );

    let facesDeleted = 0;
    for (const face of oldFaces) {
      // Delete from S3 if stored there
      if (face.face_image_s3_key) {
        await deleteObject(face.face_image_s3_key);
      }
      // Delete local face crop image file
      if (face.face_image && existsSync(face.face_image)) {
        try { unlinkSync(face.face_image); } catch { /* ok */ }
      }
      await pool.query('DELETE FROM face_embeddings WHERE id = $1', [face.id]);
      facesDeleted++;
    }

    if (facesDeleted > 0) {
      console.log(`[Cleanup] Camera ${camera.name}: deleted ${facesDeleted} old face embeddings`);
    }

    // Also clean old daily_visitors records beyond retention
    await pool.query(
      `DELETE FROM daily_visitors
       WHERE camera_id = $1
         AND visit_date < (now() - ($2 || ' days')::interval)::date`,
      [camera.id, camera.retention_days]
    );
  } catch (err) {
    console.error(`[Cleanup] Error cleaning face data for ${camera.name}:`, err.message);
  }

  return { deleted, freed };
}
