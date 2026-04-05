import { pool } from '../db/pool.js';

/**
 * Track manager — mantém o ciclo de vida dos person_tracks em memória
 * enquanto a câmera está ativa, e persiste no banco quando os tracks
 * terminam (pessoa sai do campo de visão por mais de STALE_TRACK_MS).
 *
 * Cada track representa UMA passagem de UMA pessoa física numa câmera.
 * O count de visitantes é depois calculado sobre a tabela person_tracks,
 * desduplicado cross-camera via clustering de best_embedding.
 */

const STALE_TRACK_MS = 15_000; // Track ocioso por 15s → finalizado

// Estado em memória: Map<cameraId, Map<trackerId, TrackState>>
// TrackState: {
//   trackUuid, tenantId, trackerId, lastBbox, lastSeenAt,
//   bestEmbedding, bestFacePath, bestFaceS3Key, bestQualityScore, faceCount
// }
const activeTracks = new Map();

function getCameraMap(cameraId) {
  let map = activeTracks.get(cameraId);
  if (!map) {
    map = new Map();
    activeTracks.set(cameraId, map);
  }
  return map;
}

/**
 * Intersection over Union de dois bboxes no formato [x1, y1, x2, y2].
 */
export function iou(boxA, boxB) {
  const [ax1, ay1, ax2, ay2] = boxA;
  const [bx1, by1, bx2, by2] = boxB;
  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const areaA = Math.max(0, (ax2 - ax1) * (ay2 - ay1));
  const areaB = Math.max(0, (bx2 - bx1) * (by2 - by1));
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Verifica se o bbox do rosto está contido (ou majoritariamente contido)
 * no bbox da pessoa. Usado pra linkar um rosto detectado ao track correto.
 * Retorna a razão (0..1) da área do rosto que está dentro da pessoa.
 */
export function faceInPersonRatio(faceBox, personBox) {
  const [fx1, fy1, fx2, fy2] = faceBox;
  const [px1, py1, px2, py2] = personBox;
  const x1 = Math.max(fx1, px1);
  const y1 = Math.max(fy1, py1);
  const x2 = Math.min(fx2, px2);
  const y2 = Math.min(fy2, py2);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const faceArea = Math.max(1, (fx2 - fx1) * (fy2 - fy1));
  return inter / faceArea;
}

/**
 * Processa o resultado de /track-persons: cria tracks novos no banco,
 * atualiza lastBbox/lastSeenAt dos existentes.
 * Retorna um array enriquecido: [{ tracker_id, bbox, track_uuid }]
 */
export async function updateTracksFromResponse(cameraId, tenantId, trackedPersons) {
  const cameraMap = getCameraMap(cameraId);
  const now = Date.now();
  const enriched = [];

  for (const p of trackedPersons) {
    const trackerId = p.tracker_id;
    const bbox = p.bbox;
    let state = cameraMap.get(trackerId);

    if (!state) {
      // Novo track → INSERT em person_tracks
      try {
        const { rows } = await pool.query(
          `INSERT INTO person_tracks (camera_id, tenant_id, tracker_id, started_at)
           VALUES ($1, $2, $3, now())
           RETURNING id`,
          [cameraId, tenantId, trackerId]
        );
        state = {
          trackUuid: rows[0].id,
          tenantId,
          trackerId,
          lastBbox: bbox,
          lastSeenAt: now,
          bestEmbedding: null,
          bestFacePath: null,
          bestFaceS3Key: null,
          bestQualityScore: 0,
          faceCount: 0,
        };
        cameraMap.set(trackerId, state);
      } catch (err) {
        // Se o INSERT falhar, pula esse track mas não derruba o fluxo
        console.error(`[track-manager] Failed to create track for camera ${cameraId}, tracker ${trackerId}:`, err.message);
        continue;
      }
    } else {
      state.lastBbox = bbox;
      state.lastSeenAt = now;
    }

    enriched.push({ tracker_id: trackerId, bbox, track_uuid: state.trackUuid });
  }

  return enriched;
}

/**
 * Dado um bbox de rosto, encontra o track ativo cuja bbox de pessoa
 * melhor contém esse rosto. Retorna null se nenhum passar o threshold mínimo.
 */
export function findTrackForFace(cameraId, faceBbox) {
  const cameraMap = activeTracks.get(cameraId);
  if (!cameraMap || cameraMap.size === 0) return null;

  let bestState = null;
  let bestRatio = 0.3; // mínimo: 30% da área do rosto dentro do bbox da pessoa

  for (const state of cameraMap.values()) {
    const ratio = faceInPersonRatio(faceBbox, state.lastBbox);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestState = state;
    }
  }

  return bestState;
}

/**
 * Atualiza o "melhor frame" de um track após um rosto ter sido associado.
 * Chamado depois que um face_embedding é inserido com track_id preenchido.
 */
export function onFaceAttached(cameraId, trackUuid, qualityScore, embeddingStr, facePath, faceS3Key) {
  const cameraMap = activeTracks.get(cameraId);
  if (!cameraMap) return;

  // Localiza o state pelo trackUuid (raro, mas necessário)
  for (const state of cameraMap.values()) {
    if (state.trackUuid === trackUuid) {
      state.faceCount++;
      if (qualityScore > state.bestQualityScore) {
        state.bestQualityScore = qualityScore;
        state.bestEmbedding = embeddingStr;
        state.bestFacePath = facePath;
        state.bestFaceS3Key = faceS3Key;
      }
      return;
    }
  }
}

/**
 * Finaliza um track individual: salva best_embedding/best_face_image/face_count
 * no banco e remove da memória. Se o track nunca teve um rosto associado,
 * é deletado (não é um visitante real, só passagem/movimento sem identificação).
 */
async function finalizeTrack(cameraId, state) {
  try {
    if (state.faceCount > 0 && state.bestEmbedding) {
      await pool.query(
        `UPDATE person_tracks
         SET ended_at = now(),
             best_embedding = $1::vector,
             best_face_image = $2,
             best_face_image_s3_key = $3,
             best_quality_score = $4,
             face_count = $5
         WHERE id = $6`,
        [
          state.bestEmbedding,
          state.bestFacePath,
          state.bestFaceS3Key,
          state.bestQualityScore,
          state.faceCount,
          state.trackUuid,
        ]
      );
    } else {
      // Sem rostos = passagem não identificada → descarta
      await pool.query('DELETE FROM person_tracks WHERE id = $1', [state.trackUuid]);
    }
  } catch (err) {
    console.error(`[track-manager] Error finalizing track ${state.trackUuid}:`, err.message);
  }
}

/**
 * Chamado periodicamente pelo motion-detector: finaliza tracks ociosos.
 */
export async function finalizeStaleTracks() {
  const now = Date.now();
  let finalized = 0;

  for (const [cameraId, cameraMap] of activeTracks) {
    const toRemove = [];
    for (const [trackerId, state] of cameraMap) {
      if (now - state.lastSeenAt > STALE_TRACK_MS) {
        await finalizeTrack(cameraId, state);
        toRemove.push(trackerId);
        finalized++;
      }
    }
    for (const trackerId of toRemove) cameraMap.delete(trackerId);
    if (cameraMap.size === 0) activeTracks.delete(cameraId);
  }

  if (finalized > 0) {
    console.log(`[track-manager] Finalized ${finalized} stale track(s)`);
  }
}

/**
 * Finaliza todos os tracks de uma câmera (chamado quando ela fica offline).
 */
export async function finalizeAllTracksForCamera(cameraId) {
  const cameraMap = activeTracks.get(cameraId);
  if (!cameraMap) return;

  for (const state of cameraMap.values()) {
    await finalizeTrack(cameraId, state);
  }
  activeTracks.delete(cameraId);
}

/**
 * Snapshot do estado (útil pra debugging/stats).
 */
export function getActiveTracksStats() {
  const stats = {};
  for (const [cameraId, cameraMap] of activeTracks) {
    stats[cameraId] = {
      active_count: cameraMap.size,
      tracks: Array.from(cameraMap.values()).map(s => ({
        tracker_id: s.trackerId,
        track_uuid: s.trackUuid,
        face_count: s.faceCount,
        best_quality: s.bestQualityScore,
        last_seen_ms_ago: Date.now() - s.lastSeenAt,
      })),
    };
  }
  return stats;
}
