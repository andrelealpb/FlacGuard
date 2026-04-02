import { pool } from '../db/pool.js';
import { logCameraStatusChange } from './camera-availability.js';

const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds without heartbeat

/**
 * Marks cameras as offline if they haven't been seen recently.
 * Intended to run on a periodic interval.
 */
export async function checkCameraHealth() {
  const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS).toISOString();

  // Fetch cameras that will go offline BEFORE updating, so we can log the transition
  const { rows: goingOffline } = await pool.query(
    `SELECT id, tenant_id, name FROM cameras
     WHERE status = 'online' AND last_seen_at < $1`,
    [threshold]
  );

  if (goingOffline.length > 0) {
    await pool.query(
      `UPDATE cameras
       SET status = 'offline', updated_at = now()
       WHERE status = 'online' AND last_seen_at < $1`,
      [threshold]
    );

    console.log(`Marked ${goingOffline.length} camera(s) as offline (no heartbeat)`);

    // Log availability transitions
    for (const cam of goingOffline) {
      logCameraStatusChange(cam.id, cam.tenant_id, 'offline').catch(err =>
        console.error(`[availability] Error logging offline for ${cam.name}:`, err.message)
      );
    }
  }

  // Create offline events
  const { rows: offlineCameras } = await pool.query(
    `SELECT id FROM cameras
     WHERE status = 'offline' AND last_seen_at < $1
     AND id NOT IN (
       SELECT camera_id FROM events
       WHERE type = 'offline' AND created_at > $1
     )`,
    [threshold]
  );

  for (const cam of offlineCameras) {
    await pool.query(
      `INSERT INTO events (camera_id, type, payload) VALUES ($1, 'offline', '{}')`,
      [cam.id]
    );
  }
}

// Run health check every 60 seconds
setInterval(checkCameraHealth, 60_000);
