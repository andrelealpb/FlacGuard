#!/bin/bash
set -e

echo "=== Flac Guard - Deploy Webhook Setup ==="

DEPLOY_DIR="/opt/FlacGuard"

# Generate webhook secret if not set
if ! grep -q WEBHOOK_SECRET "$DEPLOY_DIR/.env" 2>/dev/null; then
  SECRET=$(openssl rand -hex 32)
  echo "WEBHOOK_SECRET=$SECRET" >> "$DEPLOY_DIR/.env"
  echo ""
  echo "Generated webhook secret: $SECRET"
  echo "Save this! You'll need it to configure the GitHub webhook."
  echo ""
fi

# Make deploy script executable
chmod +x "$DEPLOY_DIR/deploy/deploy.sh"

# Ensure deploy-status.json exists (avoid stuck "deploying" on first run)
if [ ! -f "$DEPLOY_DIR/deploy-status.json" ]; then
  echo '{"status":"unknown","message":"Nenhum deploy registrado ainda"}' > "$DEPLOY_DIR/deploy-status.json"
fi

# Install systemd service
cp "$DEPLOY_DIR/deploy/flac-guard-webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable flac-guard-webhook
systemctl restart flac-guard-webhook

echo ""
echo "=== Webhook Status ==="
systemctl status flac-guard-webhook --no-pager -l

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Webhook running on port 9000"
echo ""
echo "Configure GitHub webhook:"
echo "  1. Go to: https://github.com/andrelealpb/FlacGuard/settings/hooks/new"
echo "  2. Payload URL: http://YOUR_SERVER_IP:9000/webhook"
echo "  3. Content type: application/json"
echo "  4. Secret: (the secret shown above, or check .env)"
echo "  5. Events: Just the push event"
echo ""
echo "=== Diagnósticos ==="
echo "  Testar deploy manual: curl -X POST http://localhost:9000/deploy"
echo "  Ver status:           curl http://localhost:9000/status"
echo "  Ver logs:             curl http://localhost:9000/logs"
echo "  Logs do systemd:      journalctl -u flac-guard-webhook -f"
echo ""
