#!/bin/bash
set -e

DEPLOY_DIR="/opt/happydo-guard"
STATUS_FILE="$DEPLOY_DIR/deploy-status.json"
LOG_PREFIX="[deploy]"
STARTED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

echo "$LOG_PREFIX $STARTED_AT Starting deploy..."

cd "$DEPLOY_DIR"

# Write "deploying" status
echo "{\"status\":\"deploying\",\"started_at\":\"$STARTED_AT\"}" > "$STATUS_FILE"

# Pull latest changes
echo "$LOG_PREFIX Pulling latest code..."
git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git reset --hard "origin/$BRANCH"

COMMIT_HASH=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=%s)
COMMIT_AUTHOR=$(git log -1 --pretty=%an)

# Rebuild and restart containers
echo "$LOG_PREFIX Building and restarting containers..."
docker compose up -d --build --remove-orphans

# Wait for health checks
echo "$LOG_PREFIX Waiting for services..."
sleep 10

# Check health
API_HEALTH=$(curl -sf http://localhost:8000/health || echo '{"status":"error"}')
RTMP_HEALTH=$(curl -sf http://localhost:8080/health || echo '{"status":"error"}')

echo "$LOG_PREFIX API:  $API_HEALTH"
echo "$LOG_PREFIX RTMP: $RTMP_HEALTH"

# Determine overall status
FINISHED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if echo "$API_HEALTH" | grep -q '"ok"' && echo "$RTMP_HEALTH" | grep -q '"ok"'; then
  DEPLOY_STATUS="success"
else
  DEPLOY_STATUS="degraded"
fi

# Write final status file
cat > "$STATUS_FILE" <<STATUSEOF
{
  "status": "$DEPLOY_STATUS",
  "commit": "$COMMIT_HASH",
  "commit_message": "$COMMIT_MSG",
  "commit_author": "$COMMIT_AUTHOR",
  "branch": "$BRANCH",
  "started_at": "$STARTED_AT",
  "finished_at": "$FINISHED_AT"
}
STATUSEOF

# Cleanup old images
docker image prune -f 2>/dev/null || true

echo "$LOG_PREFIX $FINISHED_AT Deploy complete! Status: $DEPLOY_STATUS"
