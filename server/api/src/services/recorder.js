import { spawn, spawnSync } from 'child_process';
import { existsSync, statSync, mkdirSync, unlinkSync } from 'fs';
import { pool } from '../db/pool.js';
import { uploadRecording, isS3Configured } from './storage.js';

// Active recording processes per camera
const activeRecordings = new Map();

// Ensure recordings directory exists
const RECORDINGS_DIR = '/data/recordings';

// How long to wait for FFmpeg to flush after sending 'q' before SIGKILL.
// Larger recordings need more time to write final fragments to disk.
const FFMPEG_GRACEFUL_TIMEOUT_MS = 15_000;

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Validate that a recording file is a playable MP4.
 * Uses ffprobe to confirm the moov atom is present and at least one
 * video stream is decodable. Returns true if valid, false otherwise.
 *
 * Catches the case where ffmpeg was interrupted mid-recording (camera
 * disconnect, SIGKILL, deploy) and the resulting file is corrupted.
 */
function isValidMp4(filePath) {
  try {
    const result = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath,
    ], { timeout: 10_000 });

    if (result.status !== 0) return false;
    const output = String(result.stdout || '').trim();
    return output === 'video';
  } catch {
    return false;
  }
}

/**
 * Start an FFmpeg recording for a camera.
 * Uses HLS as source (includes ~12s pre-buffer from HLS segments).
 */
export function startRecording(camera, recordingType = 'motion', thumbnailPath = null) {
  const { id, stream_key, name } = camera;

  if (activeRecordings.has(id)) {
    console.log(`[Recorder] Camera ${name} already recording, skipping`);
    return;
  }

  ensureDir(RECORDINGS_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${stream_key}-${recordingType}-${timestamp}.mp4`;
  const filePath = `${RECORDINGS_DIR}/${filename}`;
  const hlsUrl = `http://nginx-rtmp:8080/hls/${stream_key}.m3u8`;
  const startedAt = new Date();

  // Use HLS as source: FFmpeg will start from the earliest available segment
  // With hls_playlist_length=60 and hls_fragment=3, we get ~24s of pre-buffer
  //
  // Use FRAGMENTED MP4 instead of +faststart so the file remains playable
  // even if ffmpeg is interrupted (camera disconnect, SIGKILL, deploy).
  // With +faststart, the moov atom is only written when ffmpeg finishes
  // normally — if interrupted, the moov is missing and the file cannot
  // be played. With frag_keyframe+empty_moov+default_base_moof, each
  // fragment carries its own metadata, so partial recordings are valid.
  const ffmpegArgs = [
    '-live_start_index', '-8',  // Start 8 segments back (~24s pre-buffer)
    '-i', hlsUrl,
    '-c', 'copy',               // No re-encoding
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-loglevel', 'warning',
    '-y',
    filePath,
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  let stderr = '';

  ffmpeg.stderr.on('data', (data) => {
    stderr += data.toString();
    // Keep only last 500 chars of stderr
    if (stderr.length > 500) stderr = stderr.slice(-500);
  });

  ffmpeg.on('close', async (code) => {
    activeRecordings.delete(id);

    const endedAt = new Date();
    const durationSec = Math.round((endedAt - startedAt) / 1000);

    // Get file size
    let fileSize = null;
    try {
      if (existsSync(filePath)) {
        fileSize = statSync(filePath).size;
      }
    } catch {
      // ignore
    }

    // Only save recording if file exists, has reasonable size (> 10KB),
    // AND is a valid playable MP4 (moov atom present, video stream decodable).
    // The MP4 validation catches files corrupted by interrupted ffmpeg processes
    // (camera mid-recording disconnects, deploy restarts, etc.) before they
    // pollute the database and S3.
    if (fileSize && fileSize > 10240 && isValidMp4(filePath)) {
      try {
        const { rows: recRows } = await pool.query(
          `INSERT INTO recordings (camera_id, file_path, file_size, duration, started_at, ended_at, thumbnail_path, recording_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [id, filePath, fileSize, durationSec, startedAt, endedAt, thumbnailPath, recordingType]
        );

        console.log(`[Recorder] Camera ${name}: saved ${recordingType} recording (${durationSec}s, ${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

        // Upload to S3 in background (non-blocking)
        if (isS3Configured() && recRows[0]) {
          const recId = recRows[0].id;
          // Get tenant_id from camera
          const { rows: camRows } = await pool.query('SELECT tenant_id FROM cameras WHERE id = $1', [id]);
          const tenantId = camRows[0]?.tenant_id;
          if (tenantId) {
            console.log(`[Recorder] S3 upload starting for ${name}: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
            const s3Result = await uploadRecording(filePath, tenantId, id);
            if (s3Result) {
              await pool.query('UPDATE recordings SET s3_key = $1 WHERE id = $2', [s3Result.s3Key, recId]);
              console.log(`[Recorder] S3 upload complete for ${name}: ${s3Result.s3Key}`);
            } else {
              console.error(`[Recorder] S3 upload FAILED for ${name}: ${filePath} — file kept on local disk`);
            }
          } else {
            console.warn(`[Recorder] No tenant_id for camera ${name} (id=${id}), skipping S3 upload`);
          }
        } else if (!isS3Configured()) {
          console.log(`[Recorder] S3 not configured, keeping recording on local disk`);
        }
      } catch (err) {
        console.error(`[Recorder] Error saving recording for ${name}:`, err.message);
      }
    } else {
      // Recording was rejected: too small, missing, or corrupted MP4.
      // Clean up the broken file from disk so it doesn't accumulate.
      let reason = 'missing or empty';
      if (fileSize && fileSize <= 10240) reason = `too small (${fileSize} bytes)`;
      else if (fileSize && fileSize > 10240) reason = 'invalid MP4 (no moov atom or no video stream)';
      console.log(`[Recorder] Camera ${name}: recording discarded — ${reason}`);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch { /* ignore */ }
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`[Recorder] FFmpeg error for ${name}:`, err.message);
    activeRecordings.delete(id);
  });

  activeRecordings.set(id, { process: ffmpeg, startedAt, filePath, recordingType });

  console.log(`[Recorder] Camera ${name}: started ${recordingType} recording → ${filename}`);
}

/**
 * Stop recording for a camera (sends SIGINT for graceful shutdown).
 */
export function stopRecording(cameraId) {
  const recording = activeRecordings.get(cameraId);
  if (!recording) return;

  try {
    // Send 'q' to FFmpeg stdin for graceful stop (finalizes MP4)
    recording.process.stdin.write('q');
  } catch {
    // If stdin write fails, use SIGINT
    try {
      recording.process.kill('SIGINT');
    } catch {
      // Process may have already exited
    }
  }

  // Force kill if still running after the graceful timeout.
  // Larger recordings need more time to write final fragments to disk before exit.
  setTimeout(() => {
    try {
      recording.process.kill('SIGKILL');
    } catch {
      // Already exited
    }
  }, FFMPEG_GRACEFUL_TIMEOUT_MS);
}

/**
 * Check if a camera is currently recording.
 */
export function isRecording(cameraId) {
  return activeRecordings.has(cameraId);
}

/**
 * Start continuous recording for a camera.
 * Segments recording into 30-minute chunks.
 */
export function startContinuousRecording(camera) {
  const { id, name } = camera;

  if (activeRecordings.has(id)) return;

  startRecording(camera, 'continuous', null);

  // Restart recording every 30 minutes for segmentation
  const SEGMENT_DURATION = 30 * 60 * 1000; // 30 minutes

  const segmentTimer = setInterval(() => {
    if (!activeRecordings.has(id)) {
      clearInterval(segmentTimer);
      return;
    }
    stopRecording(id);
    // Wait for FFmpeg to finalize, then start new segment
    setTimeout(() => {
      if (activeRecordings.has(id)) return; // Already restarted
      startRecording(camera, 'continuous', null);
    }, 3000);
  }, SEGMENT_DURATION);

  // Store timer reference
  const rec = activeRecordings.get(id);
  if (rec) rec.segmentTimer = segmentTimer;
}

/**
 * Manage continuous recording for all cameras with recording_mode='continuous'.
 */
export async function manageContinuousRecordings() {
  try {
    const { rows: cameras } = await pool.query(
      `SELECT id, name, stream_key, recording_mode, status
       FROM cameras
       WHERE status = 'online' AND recording_mode = 'continuous'`
    );

    for (const camera of cameras) {
      if (!activeRecordings.has(camera.id)) {
        startContinuousRecording(camera);
      }
    }
  } catch (err) {
    console.error('[Recorder] Error managing continuous recordings:', err.message);
  }
}

/**
 * Stop all active recordings.
 */
export function stopAllRecordings() {
  for (const [cameraId, recording] of activeRecordings) {
    if (recording.segmentTimer) clearInterval(recording.segmentTimer);
    stopRecording(cameraId);
  }
}
