#!/bin/bash
# Flac Guard — Agent installer for Pi Zero 2 W
# Installs FFmpeg and sets up the RTSP-to-RTMP bridge service.

set -euo pipefail

echo "=== Flac Guard Agent Installer ==="

# Install FFmpeg
echo "Installing FFmpeg..."
sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg

# Create config directory
sudo mkdir -p /etc/flac
sudo mkdir -p /opt/flac

# Copy scripts
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sudo cp "$SCRIPT_DIR/rtsp-to-rtmp.sh" /opt/flac/
sudo chmod +x /opt/flac/rtsp-to-rtmp.sh

# Create default config if not exists
if [ ! -f /etc/flac-agent.conf ]; then
  cat <<'CONF' | sudo tee /etc/flac-agent.conf
CAMERA_IP=192.168.1.100
CAMERA_USER=admin
CAMERA_PASS=CHANGE_ME
RTSP_PORT=554
SERVER_URL=rtmp://SEU_SERVIDOR:1935/live
STREAM_KEY=CHANGE_ME
CONF
  echo "Created /etc/flac-agent.conf — edit with your camera details"
fi

# Install systemd service
sudo cp "$SCRIPT_DIR/systemd/flac-agent.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable flac-agent

echo ""
echo "=== Installation complete ==="
echo "1. Edit /etc/flac-agent.conf with your camera and server details"
echo "2. Start the service: sudo systemctl start flac-agent"
echo "3. Check status: sudo systemctl status flac-agent"
