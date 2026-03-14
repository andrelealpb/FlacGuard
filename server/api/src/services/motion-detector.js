import { spawn } from 'child_process';
import { pool } from '../db/pool.js';
import { startRecording, stopRecording, isRecording } from './recorder.js';
import { detectFaces, storeFaceEmbeddings, checkWatchlist, isFaceServiceHealthy } from './face-recognition.js';

// Per-camera state
const cameraStates = new Map();

// Face service availability (checked periodically)
let faceServiceAvailable = false;
async function checkFaceService() {
  faceServiceAvailable = await isFaceServiceHealthy();
  if (faceServiceAvailable) {
    console.log('[Face] Face detection service is available');
  }
}
// Check every 30s
setInterval(checkFaceService, 30000);
setTimeout(checkFaceService, 5000); // Initial check after 5s

// Extract a single frame from HLS stream as raw RGB buffer
function extractFrame(hlsUrl) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', hlsUrl,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-vf', 'scale=320:240',
      '-loglevel', 'error',
      '-y',
      'pipe:1',
    ]);

    const chunks = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

    ffmpeg.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        reject(new Error(`FFmpeg frame extraction failed (code ${code}): ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.on('error', reject);

    // Timeout after 10 seconds
    setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error('Frame extraction timeout'));
    }, 10000);
  });
}

// Compare two raw RGB frames and return the percentage of changed pixels
function compareFrames(frame1, frame2, threshold) {
  if (frame1.length !== frame2.length) return 100; // Different sizes = motion

  const pixelCount = frame1.length / 3;
  let changedPixels = 0;
  const pixelThreshold = 30; // Per-pixel RGB difference threshold

  for (let i = 0; i < frame1.length; i += 3) {
    const rDiff = Math.abs(frame1[i] - frame2[i]);
    const gDiff = Math.abs(frame1[i + 1] - frame2[i + 1]);
    const bDiff = Math.abs(frame1[i + 2] - frame2[i + 2]);
    const avgDiff = (rDiff + gDiff + bDiff) / 3;

    if (avgDiff > pixelThreshold) {
      changedPixels++;
    }
  }

  return (changedPixels / pixelCount) * 100;
}

// Save a thumbnail frame as JPEG
function saveFrameAsJpeg(hlsUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', hlsUrl,
      '-frames:v', '1',
      '-vf', 'scale=320:240',
      '-q:v', '5',
      '-loglevel', 'error',
      '-y',
      outputPath,
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Thumbnail save failed (code ${code})`));
    });

    ffmpeg.on('error', reject);

    setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error('Thumbnail save timeout'));
    }, 10000);
  });
}

// Extract a single frame as JPEG buffer (for face detection)
function extractFrameJpeg(hlsUrl) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', hlsUrl,
      '-frames:v', '1',
      '-vf', 'scale=640:480',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      '-loglevel', 'error',
      '-y',
      'pipe:1',
    ]);

    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.on('close', (code) => {
      if (code !== 0 || chunks.length === 0) {
        reject(new Error('JPEG frame extraction failed'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ffmpeg.on('error', reject);
    setTimeout(() => { ffmpeg.kill('SIGKILL'); reject(new Error('JPEG frame timeout')); }, 10000);
  });
}

// Process face detection for a frame (runs async, doesn't block motion detection)
async function processFaces(camera, hlsUrl) {
  try {
    const jpegBuffer = await extractFrameJpeg(hlsUrl);
    const faces = await detectFaces(jpegBuffer);

    if (faces.length === 0) return;

    const embeddingIds = await storeFaceEmbeddings(camera.id, faces, new Date());

    // Check against watchlist
    if (embeddingIds.length > 0) {
      await checkWatchlist(camera.id, embeddingIds);
    }
  } catch (err) {
    // Only log occasionally to avoid spam
    if (Math.random() < 0.05) {
      console.error(`[Face] Error for camera ${camera.name}:`, err.message?.slice(0, 100));
    }
  }
}

// Process a single camera for motion detection
async function processCamera(camera) {
  const { id, stream_key, motion_sensitivity, recording_mode } = camera;
  const hlsUrl = `http://nginx-rtmp:8080/hls/${stream_key}.m3u8`;

  let state = cameraStates.get(id);
  if (!state) {
    state = {
      previousFrame: null,
      motionActive: false,
      lastMotionAt: null,
      motionStartAt: null,
      postBufferTimer: null,
    };
    cameraStates.set(id, state);
  }

  try {
    const currentFrame = await extractFrame(hlsUrl);

    if (state.previousFrame) {
      const changePercent = compareFrames(state.previousFrame, currentFrame, motion_sensitivity);
      const motionDetected = changePercent >= motion_sensitivity;

      if (motionDetected) {
        state.lastMotionAt = Date.now();

        // Clear post-buffer timer if set
        if (state.postBufferTimer) {
          clearTimeout(state.postBufferTimer);
          state.postBufferTimer = null;
        }

        if (!state.motionActive) {
          // Motion just started
          state.motionActive = true;
          state.motionStartAt = new Date();

          console.log(`[Motion] Camera ${camera.name} (${id}): motion detected (${changePercent.toFixed(1)}% change)`);

          // Create motion event
          await pool.query(
            `INSERT INTO events (camera_id, type, payload)
             VALUES ($1, 'motion', $2)`,
            [id, JSON.stringify({
              change_percent: parseFloat(changePercent.toFixed(1)),
              sensitivity: motion_sensitivity,
              action: 'start',
            })]
          );

          // Start recording if in motion mode
          if (recording_mode === 'motion') {
            try {
              const thumbnailPath = `/data/recordings/${stream_key}-thumb-${Date.now()}.jpg`;
              await saveFrameAsJpeg(hlsUrl, thumbnailPath);
              startRecording(camera, 'motion', thumbnailPath);
            } catch (thumbErr) {
              console.error(`[Motion] Thumbnail error for ${camera.name}:`, thumbErr.message);
              startRecording(camera, 'motion', null);
            }
          }
        }
      } else if (state.motionActive && !state.postBufferTimer) {
        // No motion detected but motion was active - start post-buffer countdown
        const POST_BUFFER_MS = 30000; // 30 seconds
        state.postBufferTimer = setTimeout(async () => {
          state.motionActive = false;
          const motionEndAt = new Date();

          console.log(`[Motion] Camera ${camera.name} (${id}): motion ended (post-buffer expired)`);

          // Create motion end event
          try {
            await pool.query(
              `INSERT INTO events (camera_id, type, payload)
               VALUES ($1, 'motion', $2)`,
              [id, JSON.stringify({
                action: 'end',
                started_at: state.motionStartAt?.toISOString(),
                ended_at: motionEndAt.toISOString(),
                duration_seconds: Math.round((motionEndAt - state.motionStartAt) / 1000),
              })]
            );
          } catch (err) {
            console.error(`[Motion] Error creating end event for ${camera.name}:`, err.message);
          }

          // Stop recording if in motion mode
          if (recording_mode === 'motion') {
            stopRecording(id);
          }

          state.motionStartAt = null;
          state.postBufferTimer = null;
        }, POST_BUFFER_MS);
      }
    }

    // Face detection: run async (non-blocking) when face service is available
    // Process every frame when motion is active, or every ~5th frame when idle
    if (faceServiceAvailable) {
      const shouldProcess = state.motionActive || Math.random() < 0.2;
      if (shouldProcess) {
        processFaces(camera, hlsUrl).catch(() => {});
      }
    }

    state.previousFrame = currentFrame;
  } catch (err) {
    // Silently ignore frame extraction errors (camera may be temporarily unavailable)
    if (!err.message.includes('timeout')) {
      // Only log non-timeout errors occasionally
      if (Math.random() < 0.1) {
        console.error(`[Motion] Frame error for camera ${id}:`, err.message.slice(0, 100));
      }
    }
  }
}

// Main loop: check all online cameras for motion
let running = false;
let intervalHandle = null;

async function motionDetectionLoop() {
  if (!running) return;

  try {
    // Get all online cameras with motion detection enabled or continuous recording
    const { rows: cameras } = await pool.query(
      `SELECT id, name, stream_key, recording_mode, motion_sensitivity, status
       FROM cameras WHERE status = 'online'`
    );

    // Process cameras in parallel (but limit concurrency)
    const CONCURRENCY = 5;
    for (let i = 0; i < cameras.length; i += CONCURRENCY) {
      const batch = cameras.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((camera) => {
          // Motion detection for cameras in motion mode
          if (camera.recording_mode === 'motion') {
            return processCamera(camera);
          }
          // Face detection only for continuous-mode cameras (when face service is up)
          if (faceServiceAvailable) {
            const hlsUrl = `http://nginx-rtmp:8080/hls/${camera.stream_key}.m3u8`;
            return processFaces(camera, hlsUrl).catch(() => {});
          }
          return Promise.resolve();
        })
      );
    }
  } catch (err) {
    console.error('[Motion] Loop error:', err.message);
  }
}

export function startMotionDetector() {
  if (running) return;
  running = true;

  console.log('[Motion] Motion detector started (interval: 3s)');

  // Run every 3 seconds
  intervalHandle = setInterval(motionDetectionLoop, 3000);

  // Run immediately
  motionDetectionLoop();
}

export function stopMotionDetector() {
  running = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  // Clear all camera states and stop any active recordings
  for (const [cameraId, state] of cameraStates) {
    if (state.postBufferTimer) clearTimeout(state.postBufferTimer);
    stopRecording(cameraId);
  }
  cameraStates.clear();

  console.log('[Motion] Motion detector stopped');
}

// Clean up state when a camera goes offline
export function onCameraOffline(cameraId) {
  const state = cameraStates.get(cameraId);
  if (state) {
    if (state.postBufferTimer) clearTimeout(state.postBufferTimer);
    cameraStates.delete(cameraId);
  }
  stopRecording(cameraId);
}

// Clean up state when a camera comes online (reset)
export function onCameraOnline(cameraId) {
  cameraStates.delete(cameraId);
}
