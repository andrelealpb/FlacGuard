import { pool } from '../db/pool.js';

/**
 * Find the recording that contains a specific timestamp for a camera.
 * Returns the recording and a URL/path to serve it.
 */
export async function findRecordingByTimestamp(cameraId, timestamp, durationSec = 300) {
  // Use a window: find any recording that overlaps [timestamp - tolerance, timestamp + tolerance]
  // This accounts for slight start-time differences between cameras
  const toleranceSec = Math.max(durationSec, 300);
  const { rows } = await pool.query(
    `SELECT * FROM recordings
     WHERE camera_id = $1
       AND started_at <= ($2::timestamptz + interval '1 second' * $3)
       AND (ended_at IS NULL OR ended_at >= ($2::timestamptz - interval '1 second' * $3))
     ORDER BY ABS(EXTRACT(EPOCH FROM (started_at - $2::timestamptz)))
     LIMIT 1`,
    [cameraId, timestamp, toleranceSec]
  );

  return rows[0] || null;
}

/**
 * List recordings for a camera within a time range.
 */
export async function listRecordings(cameraId, { from, to, limit = 50, offset = 0 }) {
  const conditions = ['camera_id = $1'];
  const params = [cameraId];
  let paramIdx = 2;

  if (from) {
    conditions.push(`started_at >= $${paramIdx}`);
    params.push(from);
    paramIdx++;
  }
  if (to) {
    conditions.push(`started_at <= $${paramIdx}`);
    params.push(to);
    paramIdx++;
  }

  const where = conditions.join(' AND ');
  const { rows } = await pool.query(
    `SELECT * FROM recordings WHERE ${where}
     ORDER BY started_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, limit, offset]
  );

  return rows;
}
