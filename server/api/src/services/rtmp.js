import crypto from 'crypto';
import { pool } from '../db/pool.js';

const RTMP_HOST = process.env.RTMP_HOST || 'nginx-rtmp';
const RTMP_PORT = process.env.RTMP_PORT || '1935';
const HLS_BASE_URL = process.env.HLS_BASE_URL || 'http://nginx-rtmp:8080/hls';

// Cache for DB settings (refreshed every 60s)
let _publicSettingsCache = null;
let _publicSettingsCacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getPublicSettings() {
  const now = Date.now();
  if (_publicSettingsCache && (now - _publicSettingsCacheTime) < CACHE_TTL) {
    return _publicSettingsCache;
  }
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('rtmp_public_host', 'rtmp_public_port')"
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    _publicSettingsCache = {
      host: map.rtmp_public_host || process.env.RTMP_PUBLIC_HOST || '',
      port: map.rtmp_public_port || process.env.RTMP_PUBLIC_PORT || RTMP_PORT,
    };
    _publicSettingsCacheTime = now;
  } catch {
    // DB not ready yet, use env vars
    _publicSettingsCache = {
      host: process.env.RTMP_PUBLIC_HOST || '',
      port: process.env.RTMP_PUBLIC_PORT || RTMP_PORT,
    };
    _publicSettingsCacheTime = now;
  }
  return _publicSettingsCache;
}

export function generateStreamKey(tenantSlug = '') {
  const random = crypto.randomBytes(16).toString('base64url');
  return tenantSlug ? `${tenantSlug}_${random}` : random;
}

// Internal URL (used by recorder/nginx within Docker)
export function getRtmpUrl(streamKey) {
  return `rtmp://${RTMP_HOST}:${RTMP_PORT}/live/${streamKey}`;
}

export function getHlsUrl(streamKey) {
  return `${HLS_BASE_URL}/${streamKey}.m3u8`;
}

// Public URL (shown to users for camera configuration)
export async function getRtmpPublicUrl(streamKey) {
  const s = await getPublicSettings();
  if (!s.host) return '';
  return `rtmp://${s.host}:${s.port}/live/${streamKey}`;
}

export async function getHlsPublicUrl(streamKey) {
  const s = await getPublicSettings();
  if (!s.host) return '';
  return `http://${s.host}:8080/hls/${streamKey}.m3u8`;
}
