#!/bin/bash

DEPLOY_DIR="/opt/HappyDoGuard"
STATUS_FILE="$DEPLOY_DIR/deploy-status.json"
LOG_FILE="$DEPLOY_DIR/deploy.log"
LOG_PREFIX="[deploy]"
STARTED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Redirect all output to log file AND stdout
exec > >(tee -a "$LOG_FILE") 2>&1

# Trap errors so status never stays stuck on "deploying"
cleanup_on_error() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    FAILED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    echo "$LOG_PREFIX FAILED at $FAILED_AT (exit code: $exit_code)"
    cat > "$STATUS_FILE" <<FAILEOF
{
  "status": "failed",
  "started_at": "$STARTED_AT",
  "finished_at": "$FAILED_AT",
  "message": "Deploy falhou (exit code: $exit_code). Veja deploy.log para detalhes."
}
FAILEOF
  fi
}
trap cleanup_on_error EXIT

set -e

echo "$LOG_PREFIX $STARTED_AT Starting deploy..."

cd "$DEPLOY_DIR"

# Write "deploying" status
echo "{\"status\":\"deploying\",\"started_at\":\"$STARTED_AT\"}" > "$STATUS_FILE"

# Pull latest changes
echo "$LOG_PREFIX Pulling latest code..."
git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Save checksum of this script before update
SELF_HASH_BEFORE=$(md5sum "$0" 2>/dev/null | cut -d' ' -f1)

git reset --hard "origin/$BRANCH"

# Re-exec if deploy.sh itself was updated (bash keeps old version in memory)
SELF_HASH_AFTER=$(md5sum "$DEPLOY_DIR/deploy/deploy.sh" 2>/dev/null | cut -d' ' -f1)
if [ "$SELF_HASH_BEFORE" != "$SELF_HASH_AFTER" ] && [ "${DEPLOY_REEXEC:-}" != "1" ]; then
  echo "$LOG_PREFIX deploy.sh was updated — re-executing with new version..."
  export DEPLOY_REEXEC=1
  exec bash "$DEPLOY_DIR/deploy/deploy.sh"
fi

COMMIT_HASH=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=%s)
COMMIT_AUTHOR=$(git log -1 --pretty=%an)

# Build each service individually to capture per-service build status
BUILD_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

SERVICES="dashboard api face-service nginx-rtmp"
BUILD_RESULTS=""

for SERVICE in $SERVICES; do
  echo "$LOG_PREFIX Building $SERVICE..."
  SERVICE_BUILD_START=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  if docker compose build \
    --build-arg "BUILD_COMMIT=$COMMIT_HASH" \
    --build-arg "BUILD_BRANCH=$BRANCH" \
    --build-arg "BUILD_TIMESTAMP=$BUILD_TIMESTAMP" \
    --build-arg "BUILD_AUTHOR=$COMMIT_AUTHOR" \
    --build-arg "BUILD_MESSAGE=$COMMIT_MSG" \
    "$SERVICE" 2>&1; then
    SERVICE_BUILD_STATUS="success"
    echo "$LOG_PREFIX $SERVICE build: OK"
  else
    SERVICE_BUILD_STATUS="error"
    echo "$LOG_PREFIX $SERVICE build: FAILED"
  fi
  SERVICE_BUILD_END=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  if [ -n "$BUILD_RESULTS" ]; then BUILD_RESULTS="$BUILD_RESULTS,"; fi
  BUILD_RESULTS="$BUILD_RESULTS{\"name\":\"$SERVICE\",\"build_status\":\"$SERVICE_BUILD_STATUS\",\"build_started_at\":\"$SERVICE_BUILD_START\",\"build_finished_at\":\"$SERVICE_BUILD_END\"}"
done

echo "$LOG_PREFIX Restarting containers..."
docker compose up -d --remove-orphans

# Wait for services to start (face-service loads ML models and needs more time)
echo "$LOG_PREFIX Waiting for services..."
sleep 10

# Poll face-service health until models are loaded (up to 120s)
echo "$LOG_PREFIX Waiting for face-service models to load..."
FACE_READY=false
for i in $(seq 1 22); do
  FACE_HEALTH=$(curl -sf http://localhost:8001/health 2>/dev/null || echo '')
  if echo "$FACE_HEALTH" | grep -q '"ok"'; then
    FACE_READY=true
    echo "$LOG_PREFIX Face service ready after ~$((10 + i * 5))s"
    break
  fi
  sleep 5
done

# Check health of each service
API_HEALTH=$(curl -sf http://localhost:8000/health 2>/dev/null || echo '{"status":"error"}')
RTMP_HEALTH=$(curl -sf http://localhost:8080/health 2>/dev/null || echo '{"status":"error"}')
if [ "$FACE_READY" = "false" ]; then
  FACE_HEALTH=$(curl -sf http://localhost:8001/health 2>/dev/null || echo '{"status":"error"}')
fi

echo "$LOG_PREFIX API:  $API_HEALTH"
echo "$LOG_PREFIX RTMP: $RTMP_HEALTH"
echo "$LOG_PREFIX Face: $FACE_HEALTH"

# Get container status for all services via docker compose
CONTAINER_STATUSES=""
for SERVICE in $SERVICES db; do
  CONTAINER_STATE=$(docker compose ps --format json "$SERVICE" 2>/dev/null | head -1)
  if [ -n "$CONTAINER_STATE" ]; then
    C_STATUS=$(echo "$CONTAINER_STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('State','unknown'))" 2>/dev/null || echo "unknown")
    C_HEALTH_RAW=$(echo "$CONTAINER_STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")
  else
    C_STATUS="not_found"
    C_HEALTH_RAW=""
  fi

  if [ -n "$CONTAINER_STATUSES" ]; then CONTAINER_STATUSES="$CONTAINER_STATUSES,"; fi
  CONTAINER_STATUSES="$CONTAINER_STATUSES{\"name\":\"$SERVICE\",\"state\":\"$C_STATUS\",\"health\":\"$C_HEALTH_RAW\"}"
done

# Determine API health status values
API_OK=$(echo "$API_HEALTH" | grep -q '"ok"' && echo "true" || echo "false")
RTMP_OK=$(echo "$RTMP_HEALTH" | grep -q '"ok"' && echo "true" || echo "false")
FACE_OK=$(echo "$FACE_HEALTH" | grep -q '"ok"' && echo "true" || echo "false")

# Determine overall status
FINISHED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [ "$API_OK" = "true" ] && [ "$RTMP_OK" = "true" ] && [ "$FACE_OK" = "true" ]; then
  DEPLOY_STATUS="success"
else
  DEPLOY_STATUS="degraded"
fi

# Write final status file with build and service details
cat > "$STATUS_FILE" <<STATUSEOF
{
  "status": "$DEPLOY_STATUS",
  "commit": "$COMMIT_HASH",
  "commit_message": "$COMMIT_MSG",
  "commit_author": "$COMMIT_AUTHOR",
  "branch": "$BRANCH",
  "started_at": "$STARTED_AT",
  "finished_at": "$FINISHED_AT",
  "build": {
    "timestamp": "$BUILD_TIMESTAMP",
    "services": [$BUILD_RESULTS]
  },
  "services": {
    "api": {"healthy": $API_OK, "response": $API_HEALTH},
    "nginx_rtmp": {"healthy": $RTMP_OK, "response": $RTMP_HEALTH},
    "face_service": {"healthy": $FACE_OK, "response": $FACE_HEALTH}
  },
  "containers": [$CONTAINER_STATUSES]
}
STATUSEOF

# Cleanup old images
docker image prune -f 2>/dev/null || true

# Disable error trap since deploy completed successfully
trap - EXIT

echo "$LOG_PREFIX $FINISHED_AT Deploy complete! Status: $DEPLOY_STATUS"
