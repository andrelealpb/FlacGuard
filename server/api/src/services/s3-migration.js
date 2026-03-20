import { pool } from '../db/pool.js';
import { uploadFile, isS3Configured, buildRecordingKey } from './storage.js';
import { existsSync, unlinkSync, statSync } from 'fs';
import { basename } from 'path';

// Migration state (singleton)
const state = {
  running: false,
  paused: false,
  total: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  bytes_uploaded: 0,
  started_at: null,
  current_file: null,
  errors: [],       // last 20 errors
  concurrency: 5,
  delete_local: true,
};

export function getMigrationStatus() {
  const elapsed = state.started_at ? (Date.now() - state.started_at) / 1000 : 0;
  const speed = elapsed > 0 ? state.bytes_uploaded / elapsed : 0;
  const remaining = state.total - state.completed - state.failed - state.skipped;
  return {
    ...state,
    elapsed_seconds: Math.round(elapsed),
    speed_mbps: parseFloat((speed / 1024 / 1024).toFixed(2)),
    remaining,
    percent: state.total > 0 ? Math.round(((state.completed + state.skipped) / state.total) * 100) : 0,
  };
}

export function pauseMigration() {
  if (!state.running) return false;
  state.paused = true;
  console.log('[S3-Migration] Paused');
  return true;
}

export function resumeMigration() {
  if (!state.running || !state.paused) return false;
  state.paused = false;
  console.log('[S3-Migration] Resumed');
  return true;
}

export function cancelMigration() {
  if (!state.running) return false;
  state.running = false;
  state.paused = false;
  console.log('[S3-Migration] Cancelled');
  return true;
}

async function waitWhilePaused() {
  while (state.paused && state.running) {
    await new Promise(r => setTimeout(r, 500));
  }
}

async function uploadOne(recording) {
  const { id, file_path, camera_id, tenant_id } = recording;
  const filename = basename(file_path);

  if (!existsSync(file_path)) {
    state.skipped++;
    return;
  }

  state.current_file = filename;
  const fileSize = statSync(file_path).size;

  // Use recording date for key instead of current date
  const s3Key = buildRecordingKey(tenant_id, camera_id, filename);
  const result = await uploadFile(file_path, s3Key, 'video/mp4');

  if (result) {
    await pool.query('UPDATE recordings SET s3_key = $1 WHERE id = $2', [s3Key, id]);
    state.completed++;
    state.bytes_uploaded += fileSize;

    if (state.delete_local) {
      try {
        unlinkSync(file_path);
      } catch { /* ignore */ }
    }
  } else {
    state.failed++;
    state.errors.push({ id, file: filename, error: 'Upload failed' });
    if (state.errors.length > 20) state.errors.shift();
  }
}

export async function startMigration({ concurrency = 5, deleteLocal = true } = {}) {
  if (state.running) {
    return { error: 'Migration already running' };
  }
  if (!isS3Configured()) {
    return { error: 'S3 not configured' };
  }

  // Get all recordings without s3_key
  const { rows } = await pool.query(`
    SELECT r.id, r.file_path, r.camera_id, c.tenant_id
    FROM recordings r
    JOIN cameras c ON r.camera_id = c.id
    WHERE r.s3_key IS NULL
    ORDER BY r.started_at ASC
  `);

  if (rows.length === 0) {
    return { error: 'No recordings to migrate' };
  }

  // Initialize state
  state.running = true;
  state.paused = false;
  state.total = rows.length;
  state.completed = 0;
  state.failed = 0;
  state.skipped = 0;
  state.bytes_uploaded = 0;
  state.started_at = Date.now();
  state.current_file = null;
  state.errors = [];
  state.concurrency = concurrency;
  state.delete_local = deleteLocal;

  console.log(`[S3-Migration] Starting: ${rows.length} recordings, concurrency=${concurrency}, deleteLocal=${deleteLocal}`);

  // Run in background
  (async () => {
    let idx = 0;
    while (idx < rows.length && state.running) {
      await waitWhilePaused();
      if (!state.running) break;

      // Process batch of `concurrency` uploads in parallel
      const batch = rows.slice(idx, idx + concurrency);
      await Promise.allSettled(batch.map(rec => uploadOne(rec)));
      idx += concurrency;
    }

    state.running = false;
    state.current_file = null;
    const elapsed = ((Date.now() - state.started_at) / 1000).toFixed(0);
    console.log(`[S3-Migration] Finished: ${state.completed} uploaded, ${state.failed} failed, ${state.skipped} skipped in ${elapsed}s`);
  })();

  return { message: `Migration started: ${rows.length} recordings`, total: rows.length };
}
