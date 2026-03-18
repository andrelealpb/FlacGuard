#!/bin/bash
# Flac Guard — RTSP to RTMP bridge
# Reads from a local IC3/IC5 camera via RTSP and pushes to the cloud server via RTMP.
# Automatically reconnects on failure.

set -euo pipefail

# Load config
CONFIG_FILE="${1:-/etc/flac-guard-agent.conf}"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Config file not found: $CONFIG_FILE"
  exit 1
fi
source "$CONFIG_FILE"

RTSP_URL="rtsp://${CAMERA_USER}:${CAMERA_PASS}@${CAMERA_IP}:${RTSP_PORT}/live"
RTMP_TARGET="${SERVER_URL}/${STREAM_KEY}"

echo "Flac Agent: ${CAMERA_IP} → ${SERVER_URL}/${STREAM_KEY}"

while true; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') Starting RTSP→RTMP bridge..."

  ffmpeg -hide_banner -loglevel warning \
    -rtsp_transport tcp \
    -i "$RTSP_URL" \
    -c copy \
    -f flv \
    "$RTMP_TARGET" || true

  echo "$(date '+%Y-%m-%d %H:%M:%S') Stream disconnected, reconnecting in 10s..."
  sleep 10
done
