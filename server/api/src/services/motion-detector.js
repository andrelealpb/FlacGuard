import { spawn } from 'child_process';
import jpeg from 'jpeg-js';
import { pool } from '../db/pool.js';
import { startRecording, stopRecording, isRecording } from './recorder.js';
import { detectFaces, trackPersons, storeFaceEmbeddings, checkWatchlist, isFaceServiceHealthy, countDistinctVisitors, resetTracker } from './face-recognition.js';
import { updateTracksFromResponse, finalizeStaleTracks, finalizeAllTracksForCamera } from './track-manager.js';

// Per-camera state
const cameraStates = new Map();

// Face service availability (checked periodically).
// Telemetry is exported so /api/internal/health/face-service can report uptime
// of the flag — which is what actually gates real YOLO checks.
let faceServiceAvailable = false;
const faceServiceTelemetry = {
  available: false,
  lastTransitionAt: null,
  lastUpAt: null,
  lastDownAt: null,
  checksOk: 0,
  checksFail: 0,
  transitionsUp: 0,
  transitionsDown: 0,
};

async function checkFaceService() {
  const previous = faceServiceAvailable;
  const now = await isFaceServiceHealthy();
  faceServiceAvailable = now;
  faceServiceTelemetry.available = now;
  if (now) {
    faceServiceTelemetry.checksOk++;
    faceServiceTelemetry.lastUpAt = new Date().toISOString();
  } else {
    faceServiceTelemetry.checksFail++;
    faceServiceTelemetry.lastDownAt = new Date().toISOString();
  }
  if (previous !== now) {
    faceServiceTelemetry.lastTransitionAt = new Date().toISOString();
    if (now) {
      faceServiceTelemetry.transitionsUp++;
      console.log('[Face] Face detection service RECOVERED (flag true)');
    } else {
      faceServiceTelemetry.transitionsDown++;
      console.warn('[Face] Face detection service UNREACHABLE (flag false) — falling back');
    }
  }
}
// Check every 30s
setInterval(checkFaceService, 30000);
setTimeout(checkFaceService, 5000); // Initial check after 5s

export function getFaceServiceTelemetry() {
  return { ...faceServiceTelemetry };
}

// Snapshot of per-camera stream health — used by the Control dashboard to
// flag cameras with flaky Wi-Fi ("internet ruim" badge).
export function getCamerasHealth() {
  const now = Date.now();
  const snapshot = [];
  for (const [cameraId, state] of cameraStates.entries()) {
    const inBackoff = state.skipUntil && now < state.skipUntil;
    // A camera is "flaky" when it has a non-trivial volume of failures in
    // the rolling 24h window. Threshold picked so that a brief blip (< 20
    // failures/day) doesn't alert, but sustained instability does.
    const FLAKY_THRESHOLD = 50;
    const flaky = (state.totalFails24h || 0) >= FLAKY_THRESHOLD;
    snapshot.push({
      camera_id: cameraId,
      consecutive_fails: state.consecutiveFails || 0,
      total_fails_24h: state.totalFails24h || 0,
      in_backoff: Boolean(inBackoff),
      backoff_ms_remaining: inBackoff ? state.skipUntil - now : 0,
      last_success_at: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
      flaky,
    });
  }
  return snapshot;
}

// Decode a JPEG buffer to a downscaled raw RGB buffer (320x240) for fast
// pixel-level motion diff. Avoids a second ffmpeg call per cycle — we reuse
// the same JPEG that feeds YOLO / face detection.
function jpegToDownscaledRgb(jpegBuffer, targetW = 320, targetH = 240) {
  const { data, width, height } = jpeg.decode(jpegBuffer, { useTArray: true });
  const out = Buffer.alloc(targetW * targetH * 3);
  const xRatio = width / targetW;
  const yRatio = height / targetH;
  for (let y = 0; y < targetH; y++) {
    const srcY = Math.floor(y * yRatio);
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcIdx = (srcY * width + srcX) * 4; // RGBA
      const dstIdx = (y * targetW + x) * 3;     // RGB
      out[dstIdx] = data[srcIdx];
      out[dstIdx + 1] = data[srcIdx + 1];
      out[dstIdx + 2] = data[srcIdx + 2];
    }
  }
  return out;
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
    }, 3000);
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
    // Timeout must be < motion loop interval (3s) so failing cameras don't
    // accumulate overlapping ffmpeg processes tick after tick. 991 failures
    // in 24h × 10s hang = ~165min/day of pending ffmpeg for a single camera.
    setTimeout(() => { ffmpeg.kill('SIGKILL'); reject(new Error('JPEG frame timeout')); }, 2500);
  });
}

// Track last visitor computation per camera to avoid running too often
const lastVisitorComputation = new Map();
const VISITOR_COMPUTATION_INTERVAL = 5 * 60 * 1000; // Recompute at most every 5 minutes

// Process face detection given a frame buffer and pre-computed tracks.
// Used when the motion flow already extracted a frame and ran trackPersons
// as part of person confirmation — avoids extracting the frame again and
// running YOLO twice on the same camera cycle.
async function processFacesFromFrame(camera, jpegBuffer, enrichedTracks) {
  try {
    const faces = await detectFaces(jpegBuffer);
    if (faces.length === 0) return;

    const embeddingIds = await storeFaceEmbeddings(camera.id, faces, new Date(), enrichedTracks || []);

    if (embeddingIds.length > 0) {
      await checkWatchlist(camera.id, embeddingIds);
    }

    // Compute daily visitor count (throttled to avoid excess DB load)
    const now = Date.now();
    const lastComputed = lastVisitorComputation.get(camera.id) || 0;
    if (now - lastComputed >= VISITOR_COMPUTATION_INTERVAL) {
      lastVisitorComputation.set(camera.id, now);
      const today = new Date().toISOString().split('T')[0];
      countDistinctVisitors(camera.id, today).catch((err) => {
        if (Math.random() < 0.1) {
          console.error(`[Visitors] Computation error for camera ${camera.name}:`, err.message?.slice(0, 100));
        }
      });
    }
  } catch (err) {
    if (Math.random() < 0.05) {
      console.error(`[Face] Error for camera ${camera.name}:`, err.message?.slice(0, 100));
    }
  }
}

// Process face detection for a frame (runs async, doesn't block motion detection)
// This wrapper is used in the continuous-mode code path where we don't have
// a pre-extracted frame. It extracts the frame, runs tracking, then delegates.
async function processFaces(camera, hlsUrl) {
  try {
    const jpegBuffer = await extractFrameJpeg(hlsUrl);

    // Track persons on this frame (updates active tracks with new bboxes)
    let enrichedTracks = [];
    try {
      const trackResult = await trackPersons(jpegBuffer, camera.id);
      if (trackResult.persons && trackResult.persons.length > 0) {
        enrichedTracks = await updateTracksFromResponse(
          camera.id,
          camera.tenant_id,
          trackResult.persons
        );
      }
    } catch {
      // Tracking failure is non-fatal; continue with face detection
    }

    await processFacesFromFrame(camera, jpegBuffer, enrichedTracks);
  } catch (err) {
    if (Math.random() < 0.05) {
      console.error(`[Face] Error for camera ${camera.name}:`, err.message?.slice(0, 100));
    }
  }
}

// Check for persons using YOLO+ByteTrack. If `cachedJpeg` is provided, we
// reuse it instead of extracting another frame — critical on busy nodes where
// each ffmpeg call costs 200-500ms. Returns the jpeg buffer and enriched
// tracks so the caller can reuse them for face detection on the same frame.
// Returns { personDetected, jpegBuffer, enrichedTracks } or null on error.
async function checkPersonsWithTracking(camera, hlsUrl, cachedJpeg = null) {
  try {
    const jpegBuffer = cachedJpeg || await extractFrameJpeg(hlsUrl);
    const trackResult = await trackPersons(jpegBuffer, camera.id);
    const persons = trackResult.persons || [];

    let enrichedTracks = [];
    if (persons.length > 0) {
      enrichedTracks = await updateTracksFromResponse(
        camera.id,
        camera.tenant_id,
        persons
      );
    }

    return {
      personDetected: persons.length > 0,
      jpegBuffer,
      enrichedTracks,
    };
  } catch {
    return null;
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
      personConfirmed: false,
      personCheckAttempts: 0,
      // Exponential backoff for cameras whose HLS stream flaps
      failCount: 0,
      skipUntil: 0,
      consecutiveFails: 0,
      lastSuccessAt: null,
      totalFails24h: 0,
    };
    cameraStates.set(id, state);
  }

  // Skip cameras in backoff window — avoids wasting CPU spawning ffmpeg
  // against a stream that keeps failing (usually flaky Wi-Fi at the PDV).
  if (state.skipUntil && Date.now() < state.skipUntil) {
    return;
  }

  // Tracks whether we already ran face detection in this cycle via the
  // person-confirmation path, so the trailing fall-through below doesn't
  // extract the frame and run YOLO a second time on the same camera tick.
  let facesProcessedThisCycle = false;

  try {
    // Extract a single JPEG per cycle and reuse it for pixel-diff, YOLO and
    // face detection — saves one ffmpeg invocation per camera per tick.
    const currentJpeg = await extractFrameJpeg(hlsUrl);
    const currentFrame = jpegToDownscaledRgb(currentJpeg);

    // Extraction succeeded — reset consecutive-failure counter
    if (state.consecutiveFails > 0) {
      console.log(`[Motion] Camera ${camera.name} (${id}): stream recovered after ${state.consecutiveFails} consecutive failures`);
      state.consecutiveFails = 0;
    }
    state.lastSuccessAt = Date.now();

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
          // Motion just started — check if a person is present before recording
          state.motionActive = true;
          state.motionStartAt = new Date();
          state.personConfirmed = false;
          state.personCheckAttempts = 0;

          console.log(`[Motion] Camera ${camera.name} (${id}): pixel motion detected (${changePercent.toFixed(1)}% change), checking for persons...`);

          // Check for persons using YOLO+ByteTrack (same call that feeds tracking).
          // Reuses the extracted JPEG — no second ffmpeg, no second YOLO call.
          if (faceServiceAvailable) {
            const result = await checkPersonsWithTracking(camera, hlsUrl, currentJpeg);
            const personFound = result?.personDetected || false;
            state.personCheckAttempts++;

            if (personFound) {
              state.personConfirmed = true;
              console.log(`[Motion] Camera ${camera.name} (${id}): PERSON CONFIRMED — starting recording`);

              // Create motion event (person confirmed)
              await pool.query(
                `INSERT INTO events (camera_id, type, payload)
                 VALUES ($1, 'motion', $2)`,
                [id, JSON.stringify({
                  change_percent: parseFloat(changePercent.toFixed(1)),
                  sensitivity: motion_sensitivity,
                  action: 'start',
                  person_detected: true,
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

              // Run face detection on the SAME frame we just analysed — no second
              // frame extraction, no second YOLO call.
              if (camera.capture_face !== false && result) {
                processFacesFromFrame(camera, result.jpegBuffer, result.enrichedTracks).catch(() => {});
                facesProcessedThisCycle = true;
              }
            } else {
              console.log(`[Motion] Camera ${camera.name} (${id}): no person detected (attempt ${state.personCheckAttempts}), skipping...`);
            }
          } else {
            // Face service unreachable — strict fallback: only record if the
            // pixel change is at least 3x the camera's sensitivity. Protects
            // against blind recording storms during face-service outages while
            // still catching clearly significant motion (someone entering).
            const FALLBACK_CHANGE_MULTIPLIER = 3;
            const fallbackThreshold = motion_sensitivity * FALLBACK_CHANGE_MULTIPLIER;
            const passesFallback = changePercent >= fallbackThreshold;

            if (!passesFallback) {
              // Don't flip motionActive — let the next cycle re-evaluate fresh
              state.motionActive = false;
              state.motionStartAt = null;
              state.personCheckAttempts = 0;
              console.log(`[Motion] Camera ${camera.name} (${id}): face-service down, change ${changePercent.toFixed(1)}% < ${fallbackThreshold}% (3x sensibility) — skipping`);
            } else {
              state.personConfirmed = true;
              console.warn(`[Motion] Camera ${camera.name} (${id}): face-service down, strict fallback TRIGGERED (change ${changePercent.toFixed(1)}% >= ${fallbackThreshold}%)`);

              await pool.query(
                `INSERT INTO events (camera_id, type, payload)
                 VALUES ($1, 'motion', $2)`,
                [id, JSON.stringify({
                  change_percent: parseFloat(changePercent.toFixed(1)),
                  sensitivity: motion_sensitivity,
                  action: 'start',
                  person_detected: null,
                  fallback_reason: 'face_service_unreachable',
                })]
              );

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
          }
        } else if (state.motionActive && !state.personConfirmed && faceServiceAvailable) {
          // Motion continues but person not yet confirmed — retry detection
          // Allow up to 3 attempts (covering ~9 seconds of motion)
          const MAX_PERSON_CHECK_ATTEMPTS = 3;
          if (state.personCheckAttempts < MAX_PERSON_CHECK_ATTEMPTS) {
            const result = await checkPersonsWithTracking(camera, hlsUrl);
            const personFound = result?.personDetected || false;
            state.personCheckAttempts++;

            if (personFound) {
              state.personConfirmed = true;
              console.log(`[Motion] Camera ${camera.name} (${id}): PERSON CONFIRMED on attempt ${state.personCheckAttempts} — starting recording`);

              await pool.query(
                `INSERT INTO events (camera_id, type, payload)
                 VALUES ($1, 'motion', $2)`,
                [id, JSON.stringify({
                  change_percent: parseFloat(changePercent.toFixed(1)),
                  sensitivity: motion_sensitivity,
                  action: 'start',
                  person_detected: true,
                  detection_attempt: state.personCheckAttempts,
                })]
              );

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

              // Reuse the same frame for face detection — no duplicate work
              if (camera.capture_face !== false && result) {
                processFacesFromFrame(camera, result.jpegBuffer, result.enrichedTracks).catch(() => {});
                facesProcessedThisCycle = true;
              }
            } else {
              console.log(`[Motion] Camera ${camera.name} (${id}): no person (attempt ${state.personCheckAttempts}/${MAX_PERSON_CHECK_ATTEMPTS})`);
            }
          } else if (state.personCheckAttempts === MAX_PERSON_CHECK_ATTEMPTS) {
            // Exhausted attempts — dismiss this motion as non-person (tree, light, etc.)
            state.personCheckAttempts++; // Prevent repeated logging
            console.log(`[Motion] Camera ${camera.name} (${id}): motion dismissed — no person detected after ${MAX_PERSON_CHECK_ATTEMPTS} attempts`);
          }
        }
      } else if (state.motionActive && !state.postBufferTimer) {
        // No motion detected but motion was active — start post-buffer countdown
        // Only run post-buffer if person was confirmed (otherwise just reset)
        if (!state.personConfirmed) {
          state.motionActive = false;
          state.motionStartAt = null;
          state.personCheckAttempts = 0;
        } else {
          const POST_BUFFER_MS = 30000; // 30 seconds
          state.postBufferTimer = setTimeout(async () => {
            state.motionActive = false;
            state.personConfirmed = false;
            state.personCheckAttempts = 0;
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
    }

    // Face detection: only run when motion is active AND a real person was
    // confirmed by YOLO. The old "random idle sampling" (Math.random < 0.1)
    // was removed because it generated phantom embeddings and false visitor
    // counts from posters, reflections, TV screens, etc.
    // Continuous-mode cameras have their own separate path in the main loop
    // that doesn't go through processCamera at all.
    const shouldCaptureFace = camera.capture_face !== false;
    if (faceServiceAvailable && shouldCaptureFace && !facesProcessedThisCycle) {
      if (state.motionActive && state.personConfirmed) {
        processFaces(camera, hlsUrl).catch(() => {});
      }
    }

    state.previousFrame = currentFrame;
  } catch (err) {
    // Flaky-camera exponential backoff: after N consecutive failures the
    // camera is paused for a growing window so the API doesn't keep spawning
    // ffmpeg against a dead stream. Recovers instantly on the first success.
    state.consecutiveFails = (state.consecutiveFails || 0) + 1;
    state.failCount = (state.failCount || 0) + 1;
    state.totalFails24h = (state.totalFails24h || 0) + 1;

    const BACKOFF_AFTER = 3;
    if (state.consecutiveFails >= BACKOFF_AFTER) {
      // 30s, 60s, 120s, 240s, 300s (capped)
      const exponent = Math.min(state.consecutiveFails - BACKOFF_AFTER, 4);
      const backoffMs = Math.min(30000 * Math.pow(2, exponent), 300000);
      state.skipUntil = Date.now() + backoffMs;
      if (state.consecutiveFails === BACKOFF_AFTER || state.consecutiveFails % 10 === 0) {
        console.warn(`[Motion] Camera ${camera.name} (${id}): ${state.consecutiveFails} consecutive failures, backing off for ${backoffMs / 1000}s`);
      }
    } else if (!err.message.includes('timeout') && Math.random() < 0.1) {
      console.error(`[Motion] Frame error for camera ${id}:`, err.message.slice(0, 100));
    }
  }
}

// Reset 24h rolling counters once per hour (avoid unbounded growth and let
// operational alerts reflect recent state rather than container lifetime).
setInterval(() => {
  for (const state of cameraStates.values()) {
    if (state.totalFails24h) state.totalFails24h = Math.floor(state.totalFails24h * 0.9);
  }
}, 3600_000);

// Main loop: check all online cameras for motion
let running = false;
let intervalHandle = null;

async function motionDetectionLoop() {
  if (!running) return;

  try {
    // Get all online cameras with motion detection enabled or continuous recording
    const { rows: cameras } = await pool.query(
      `SELECT id, name, stream_key, recording_mode, motion_sensitivity, status,
              camera_purpose, capture_face, tenant_id
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
          // Face detection only for continuous-mode cameras with capture_face enabled
          if (faceServiceAvailable && camera.capture_face !== false) {
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

// Periodic track finalization — runs every 10s to close tracks whose
// persons have left the camera view (no sightings for STALE_TRACK_MS).
let trackFinalizerHandle = null;

export function startMotionDetector() {
  if (running) return;
  running = true;

  console.log('[Motion] Motion detector started (interval: 3s)');

  // Run every 3 seconds
  intervalHandle = setInterval(motionDetectionLoop, 3000);

  // Track finalizer loop — closes stale tracks so daily counts reflect reality
  trackFinalizerHandle = setInterval(() => {
    finalizeStaleTracks().catch(err =>
      console.error('[Motion] Track finalizer error:', err.message)
    );
  }, 10_000);

  // Run immediately
  motionDetectionLoop();
}

export function stopMotionDetector() {
  running = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (trackFinalizerHandle) {
    clearInterval(trackFinalizerHandle);
    trackFinalizerHandle = null;
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
  // Finalize all active tracks for this camera before resetting
  finalizeAllTracksForCamera(cameraId).catch(err =>
    console.error(`[Motion] Error finalizing tracks for camera ${cameraId}:`, err.message)
  );
  // Reset the ByteTrack state so the next session starts with fresh track IDs
  resetTracker(cameraId).catch(() => { /* best-effort */ });
}

// Clean up state when a camera comes online (reset)
export function onCameraOnline(cameraId) {
  cameraStates.delete(cameraId);
  // Reset tracker in case a previous session left stale state
  resetTracker(cameraId).catch(() => { /* best-effort */ });
}
