import { spawn } from 'child_process';
import { existsSync, statSync, mkdirSync } from 'fs';
import { pool } from '../db/pool.js';

// Active recording processes per camera
const activeRecordings = new Map();

// Ensure recordings directory exists
const RECORDINGS_DIR = '/data/recordings';

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
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
  const ffmpegArgs = [
    '-live_start_index', '-8',  // Start 8 segments back (~24s pre-buffer)
    '-i', hlsUrl,
    '-c', 'copy',               // No re-encoding
    '-movflags', '+faststart',   // Optimize for web playback
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

    // Only save recording if file exists and has reasonable size (> 10KB)
    if (fileSize && fileSize > 10240) {
      try {
        await pool.query(
          `INSERT INTO recordings (camera_id, file_path, file_size, duration, started_at, ended_at, thumbnail_path, recording_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, filePath, fileSize, durationSec, startedAt, endedAt, thumbnailPath, recordingType]
        );

        console.log(`[Recorder] Camera ${name}: saved ${recordingType} recording (${durationSec}s, ${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
      } catch (err) {
        console.error(`[Recorder] Error saving recording for ${name}:`, err.message);
      }
    } else {
      console.log(`[Recorder] Camera ${name}: recording too small or missing, discarded`);
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

  // Force kill after 5 seconds if still running
  setTimeout(() => {
    try {
      recording.process.kill('SIGKILL');
    } catch {
      // Already exited
    }
  }, 5000);
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
