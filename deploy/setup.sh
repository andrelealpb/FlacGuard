#!/bin/bash
set -e

echo "=== Flac Guard - Deploy Webhook Setup ==="

DEPLOY_DIR="/opt/FlacGuard"

# --- Git authentication for private repository ---
# Required: a GitHub Personal Access Token (PAT) with Contents:Read permission.
# Generate at: https://github.com/settings/personal-access-tokens/new
#   - Repository: andrelealpb/FlacGuard (only)
#   - Permissions: Contents → Read-only
CURRENT_URL=$(git -C "$DEPLOY_DIR" remote get-url origin 2>/dev/null || echo "")

if echo "$CURRENT_URL" | grep -qE '^https?://[^@]*github\.com'; then
  # Remote URL has no token embedded — prompt to configure
  echo ""
  echo "⚠  O repositório é privado. O deploy precisa de um GitHub PAT para fazer git fetch."
  echo ""
  read -rp "Cole seu GitHub Personal Access Token (ou Enter para pular): " GH_TOKEN
  if [ -n "$GH_TOKEN" ]; then
    git -C "$DEPLOY_DIR" remote set-url origin "https://${GH_TOKEN}@github.com/andrelealpb/FlacGuard.git"
    echo "✓ Remote atualizado com token."
    # Verify connectivity
    if git -C "$DEPLOY_DIR" fetch origin --dry-run 2>/dev/null; then
      echo "✓ Conexão com GitHub OK."
    else
      echo "✗ Falha ao conectar. Verifique o token e tente novamente."
    fi
  else
    echo "Pulando... Configure manualmente depois:"
    echo "  git -C $DEPLOY_DIR remote set-url origin https://TOKEN@github.com/andrelealpb/FlacGuard.git"
  fi
  echo ""
elif echo "$CURRENT_URL" | grep -qE 'github\.com'; then
  echo "✓ Git remote já configurado com autenticação."
fi

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
echo "=== Git (repo privado) ==="
echo "  Verificar remote:     git -C $DEPLOY_DIR remote get-url origin"
echo "  Testar conexão:       git -C $DEPLOY_DIR fetch origin --dry-run"
echo "  Atualizar token:      git -C $DEPLOY_DIR remote set-url origin https://TOKEN@github.com/andrelealpb/FlacGuard.git"
echo ""
