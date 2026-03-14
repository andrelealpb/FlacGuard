#!/bin/bash
set -e

echo "=== HappyDo Guard - Deploy Webhook Setup ==="

DEPLOY_DIR="/opt/HappyDoGuard"

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

# Install systemd service
cp "$DEPLOY_DIR/deploy/happydo-webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable happydo-webhook
systemctl restart happydo-webhook

echo ""
echo "=== Webhook Status ==="
systemctl status happydo-webhook --no-pager -l

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Webhook running on port 9000"
echo ""
echo "Now configure GitHub webhook:"
echo "  1. Go to: https://github.com/andrelealpb/HappyDoGuard/settings/hooks/new"
echo "  2. Payload URL: http://147.93.7.251:9000/webhook"
echo "  3. Content type: application/json"
echo "  4. Secret: (the secret shown above, or check .env)"
echo "  5. Events: Just the push event"
echo ""
echo "Test with: curl -X POST http://localhost:9000/deploy"
