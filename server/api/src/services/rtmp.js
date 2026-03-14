import crypto from 'crypto';

const RTMP_HOST = process.env.RTMP_HOST || 'nginx-rtmp';
const RTMP_PORT = process.env.RTMP_PORT || '1935';
const HLS_BASE_URL = process.env.HLS_BASE_URL || 'http://nginx-rtmp:8080/hls';

// Public-facing URLs for camera configuration (what you type into the camera)
const RTMP_PUBLIC_HOST = process.env.RTMP_PUBLIC_HOST || RTMP_HOST;
const RTMP_PUBLIC_PORT = process.env.RTMP_PUBLIC_PORT || RTMP_PORT;
const HLS_PUBLIC_BASE_URL = process.env.HLS_PUBLIC_BASE_URL || HLS_BASE_URL;

export function generateStreamKey() {
  return crypto.randomBytes(24).toString('base64url');
}

// Internal URL (used by recorder/nginx within Docker)
export function getRtmpUrl(streamKey) {
  return `rtmp://${RTMP_HOST}:${RTMP_PORT}/live/${streamKey}`;
}

export function getHlsUrl(streamKey) {
  return `${HLS_BASE_URL}/${streamKey}.m3u8`;
}

// Public URL (shown to users for camera configuration)
export function getRtmpPublicUrl(streamKey) {
  return `rtmp://${RTMP_PUBLIC_HOST}:${RTMP_PUBLIC_PORT}/live/${streamKey}`;
}

export function getHlsPublicUrl(streamKey) {
  return `${HLS_PUBLIC_BASE_URL}/${streamKey}.m3u8`;
}
