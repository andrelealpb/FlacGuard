#!/bin/bash
# Flac Guard — Recording script
# Converts RTMP live streams to MP4 segments for archival.
# Used as an alternative/complement to Nginx-RTMP native recording.
#
# Usage: ./record.sh <stream_key> [segment_duration_seconds]
#
# Segments are saved to /data/recordings/<stream_key>/

set -euo pipefail

STREAM_KEY="${1:?Usage: record.sh <stream_key> [segment_duration]}"
SEGMENT_DURATION="${2:-900}"  # 15 minutes default
RTMP_URL="rtmp://nginx-rtmp:1935/live/${STREAM_KEY}"
OUTPUT_DIR="/data/recordings/${STREAM_KEY}"

mkdir -p "$OUTPUT_DIR"

echo "Recording ${STREAM_KEY} in ${SEGMENT_DURATION}s segments → ${OUTPUT_DIR}"

exec ffmpeg -i "$RTMP_URL" \
  -c copy \
  -f segment \
  -segment_time "$SEGMENT_DURATION" \
  -segment_format mp4 \
  -strftime 1 \
  -reset_timestamps 1 \
  "${OUTPUT_DIR}/%Y%m%d-%H%M%S.mp4"
