import { pool } from '../db/pool.js';
import { unlinkSync, existsSync } from 'fs';

/**
 * Delete recordings older than the camera's retention_days setting.
 * Runs periodically to enforce storage limits.
 */
async function cleanupOldRecordings() {
  try {
    // Get all cameras with their retention settings
    const { rows: cameras } = await pool.query(
      `SELECT id, name, retention_days FROM cameras`
    );

    let totalDeleted = 0;
    let totalFreed = 0;

    for (const camera of cameras) {
      // Find recordings older than retention period
      const { rows: oldRecordings } = await pool.query(
        `SELECT id, file_path, file_size, thumbnail_path
         FROM recordings
         WHERE camera_id = $1
           AND started_at < now() - ($2 || ' days')::interval`,
        [camera.id, camera.retention_days]
      );

      for (const recording of oldRecordings) {
        // Delete file from disk
        try {
          if (recording.file_path && existsSync(recording.file_path)) {
            unlinkSync(recording.file_path);
          }
          if (recording.thumbnail_path && existsSync(recording.thumbnail_path)) {
            unlinkSync(recording.thumbnail_path);
          }
        } catch (err) {
          console.error(`[Cleanup] Error deleting file ${recording.file_path}:`, err.message);
        }

        // Delete from database
        await pool.query('DELETE FROM recordings WHERE id = $1', [recording.id]);

        totalDeleted++;
        totalFreed += recording.file_size || 0;
      }
    }

    if (totalDeleted > 0) {
      console.log(`[Cleanup] Deleted ${totalDeleted} old recordings, freed ${(totalFreed / 1024 / 1024 / 1024).toFixed(2)} GB`);
    }
  } catch (err) {
    console.error('[Cleanup] Error during cleanup:', err.message);
  }
}

let intervalHandle = null;

/**
 * Start the cleanup service. Runs every hour.
 */
export function startCleanupService() {
  console.log('[Cleanup] Cleanup service started (interval: 1h)');

  // Run immediately
  cleanupOldRecordings();

  // Run every hour
  intervalHandle = setInterval(cleanupOldRecordings, 60 * 60 * 1000);
}

/**
 * Stop the cleanup service.
 */
export function stopCleanupService() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[Cleanup] Cleanup service stopped');
}
