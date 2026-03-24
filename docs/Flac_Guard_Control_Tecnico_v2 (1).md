# flac-guard-control — Documento Técnico (v2)

> Repositório: `github.com/andrelealpb/flac-guard-control`
> VPS: Cloud VPS 10 Contabo ($3.96/mês, 4 cores, 8GB, US-Central)
> Domínio: flactech.com.br (Registro.br + Cloudflare DNS)
> Princípio: Control só trafega JSON — vídeo vai direto nó/S3

---

## 1. Visão Geral

O Control é o ponto único de acesso do SaaS e o hub de deploy.

**Faz:** Dashboard cliente (SPA), gateway JSON multi-nó, billing (Stripe), provisioning (Contabo + Cloudflare), deploy multi-nó, admin dashboard, landing page, email transacional.

**Não faz:** Receber RTMP, processar vídeo/facial, proxy de streams HLS/S3.

### Já implementado ✅

- Schema + 8 routes (775 linhas) + 6 services (674 linhas) + 2 scripts
- Stripe completo: checkout, 7 webhooks, portal, free tier, coupons (304 linhas)
- Admin dashboard: 5 páginas (Dashboard, Tenants, Nodes, Billing, Login)
- Landing: 4 páginas (index, pricing, checkout, welcome)
- Contabo API: provisionar VPS 30 + cloud-init
- Email: Brevo SMTP + 5 templates
- Nginx: rate limiting + SSL hardening

### A implementar

- Cloudflare API (services/cloudflare.js)
- tenant_nodes (N:N) + camera_node_map
- Gateway multi-nó (services/gateway.js + routes gateway-*.js)
- Dashboard cliente (client-dashboard/)
- Cloud-init completo (.env injetado, Certbot, Nginx, webhook)
- Deploy multi-nó (POST /api/admin/deploy)

---

## 2. Stack

| Componente | Tecnologia |
|-----------|-----------|
| API + Gateway | Node.js 20 + Express (ESM) |
| Dashboard cliente | React 18 + TypeScript + Vite |
| Dashboard admin | React (JSX) + Vite |
| Landing | HTML/CSS estático |
| Banco | PostgreSQL 16 Alpine |
| Billing | Stripe SDK v17 |
| DNS | Cloudflare API |
| VPS provisioning | Contabo API |
| Email corporativo | Google Workspace |
| Email transacional | Brevo SMTP + nodemailer |

---

## 3. Docker Compose (5 containers)

```yaml
services:
  api:              # :8000 Express (gateway + admin + billing + deploy)
  client-dashboard: # :3000 Dashboard do CLIENTE (React)
  admin-dashboard:  # :3001 Dashboard ADMIN (React)
  landing:          # :3002 Site comercial (HTML)
  db:               # PostgreSQL 16 Alpine
```

Env vars: DATABASE_URL, JWT_SECRET, STRIPE_*, BREVO_*, CONTABO_*, CLOUDFLARE_*, GITHUB_WEBHOOK_SECRET.

---

## 4. Schema (evolução multi-nó)

```sql
-- Schema atual (implementado) + evolução necessária

plans                    -- ✅ 4 planos (tester, monitoring, advanced, ultra)
nodes                    -- ✅ host, api_key, max_cameras, status, contabo_instance_id
                         -- ⏳ Adicionar: ip_address, cloudflare_record_id, vps_tier,
                         --    is_shared, ssl_provisioned, webhook_secret
tenants                  -- ✅ plan_id, stripe IDs, status
                         -- ⏳ Remover node_id (migrar para tenant_nodes)
tenant_nodes             -- ⏳ NOVA: tenant_id, node_id, camera_slots, assigned_cameras
camera_node_map          -- ⏳ NOVA: tenant_id, node_id, camera_id, stream_key
deploy_log               -- ⏳ NOVA: node_id, commit, status, duration_ms, created_at
admin_users              -- ✅
billing_events           -- ✅
node_health_log          -- ✅
```

---

## 5. API — Endpoints

### Gateway (dashboard cliente, JWT com tenant_id)

```
POST   /api/auth/login              # JWT
POST   /api/auth/setup              # Primeiro admin

GET    /api/cameras                  # Merge todos os nós
POST   /api/cameras                  # Seleciona nó → cria → registra camera_node_map
PATCH  /api/cameras/:id             # Proxy para nó da câmera
DELETE /api/cameras/:id
GET    /api/cameras/:id/live         # URL HTTPS do nó (browser conecta direto)
GET    /api/cameras/models
GET    /api/cameras/stream-names     # Merge
GET    /api/cameras/disk-usage       # Merge

GET    /api/recordings               # Merge
GET    /api/recordings/by-day        # Merge
GET    /api/recordings/:id/stream    # Pre-signed URL S3 (browser conecta direto)
GET    /api/recordings/:id/thumbnail # Proxy do nó
POST   /api/recordings/:id/detect-faces   # Proxy
POST   /api/recordings/:id/search-face    # Proxy

POST   /api/faces/search             # Distribui TODOS nós → merge por score
GET    /api/faces/watchlist           # Merge
POST   /api/faces/watchlist           # Replica em TODOS nós
POST   /api/faces/watchlist/from-appearance
PATCH  /api/faces/watchlist/:id      # Proxy
DELETE /api/faces/watchlist/:id      # Proxy + replica delete
GET    /api/faces/alerts              # Merge
GET    /api/faces/visitors            # Merge
GET    /api/faces/persons             # Merge
POST   /api/faces/persons             # Proxy (nó do embedding)
POST   /api/faces/persons/:id/search  # Distribui TODOS nós → merge
POST   /api/faces/persons/:id/watchlist  # Proxy + replica

GET    /api/pdvs                     # Merge
POST   /api/pdvs/sync                # Sync em todos nós
GET    /api/events                   # Merge
GET    /api/monitor/system           # Stats consolidados
```

### Public (✅ implementado)

```
GET    /api/plans
POST   /api/billing/checkout
POST   /api/billing/webhook
GET    /api/billing/portal/:slug
```

### Admin (✅ implementado)

```
GET/POST/PUT  /api/admin/tenants
GET/POST      /api/admin/nodes
POST          /api/admin/nodes/provision
GET           /api/admin/billing/overview
GET           /api/admin/dashboard
POST          /api/admin/auth/login|setup
```

### Deploy (⏳ novo)

```
POST   /api/admin/deploy              # GitHub webhook → redistribui para nós
POST   /api/admin/deploy/node/:id     # Deploy manual em nó específico
GET    /api/admin/deploy/status        # Status último deploy por nó
```

### Internal (✅ implementado, nós → control)

```
POST   /api/internal/nodes/:id/usage
POST   /api/internal/nodes/:id/health
```

---

## 6. Services

### services/gateway.js (⏳)

```javascript
// queryAllNodes(tenantId, path) → consulta nós em paralelo
// mergeArrayResults(nodeResults) → consolida arrays JSON
// findCameraNode(tenantId, cameraId) → qual nó tem a câmera
// proxyToNode(node, path) → proxy request específico
// selectNodeForCamera(tenantId) → nó com mais capacidade
```

### services/cloudflare.js (⏳)

```javascript
// createNodeDNS(nodeName, ipAddress) → A record, retorna record_id
// deleteNodeDNS(recordId) → remove record
```

### services/contabo.js (✅ implementado, ⏳ evoluir cloud-init)

Cloud-init atual faz git clone + docker compose up mas sem .env.
Evolução: injetar .env completo + Certbot + Nginx + webhook service.

```javascript
function generateCloudInit(config) {
  // config: { jwtSecret, internalApiKey, s3Keys, dbPassword, nodeName, webhookSecret }
  return `#!/bin/bash
apt-get update && apt-get install -y docker.io docker-compose-plugin git nginx certbot python3-certbot-nginx

git clone https://github.com/andrelealpb/FlacGuard.git /opt/FlacGuard
cd /opt/FlacGuard

cat > .env << 'ENVEOF'
JWT_SECRET=${config.jwtSecret}
INTERNAL_API_KEY=${config.internalApiKey}
S3_ENDPOINT=${config.s3Endpoint}
S3_BUCKET=${config.s3Bucket}
S3_ACCESS_KEY=${config.s3AccessKey}
S3_SECRET_KEY=${config.s3SecretKey}
S3_REGION=${config.s3Region}
POSTGRES_USER=flac_guard
POSTGRES_PASSWORD=${config.dbPassword}
POSTGRES_DB=flac_guard
WEBHOOK_SECRET=${config.webhookSecret}
ENVEOF

docker compose up -d --build
sleep 15
docker compose exec -T api node src/db/migrate.js

# SSL
certbot --nginx -d ${config.nodeName}.flactech.com.br --non-interactive --agree-tos -m leal@flactech.com.br

# Nginx HTTPS
cat > /etc/nginx/sites-available/flac-node << 'NGEOF'
server {
    listen 443 ssl;
    server_name ${config.nodeName}.flactech.com.br;
    ssl_certificate /etc/letsencrypt/live/${config.nodeName}.flactech.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.nodeName}.flactech.com.br/privkey.pem;
    location /hls/ {
        proxy_pass http://localhost:8080/hls/;
        add_header Access-Control-Allow-Origin "https://guard.flactech.com.br";
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
    }
    location /api/internal/ { proxy_pass http://localhost:8000/api/internal/; }
    location / { return 404; }
}
NGEOF
ln -sf /etc/nginx/sites-available/flac-node /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Deploy webhook
cp /opt/FlacGuard/deploy/flac-guard-webhook.service /etc/systemd/system/
systemctl enable --now flac-guard-webhook
`;
}
```

### services/deploy.js (⏳ novo)

```javascript
/**
 * Deploy multi-nó: recebe GitHub webhook, redistribui para todos os nós
 */

export async function deployToAllNodes(payload, signature) {
  // 1. Validar assinatura GitHub (HMAC-SHA256)
  // 2. Buscar todos os nós status='active'
  // 3. Para cada nó em paralelo:
  //    POST https://node-N.flactech.com.br:9000/deploy
  //    headers: { 'X-Hub-Signature-256': hmac(node.webhook_secret, body) }
  // 4. Aguardar respostas (timeout 5 min)
  // 5. Salvar em deploy_log: node_id, commit, status, duration_ms
  // 6. Se falhou → retry 1x
  // 7. Retornar relatório
}

export async function deployToNode(nodeId) {
  // Deploy manual em nó específico
}

export async function getDeployStatus() {
  // Último deploy por nó (da tabela deploy_log)
}
```

### Já implementados ✅

- **stripe.js** (304 linhas): checkout, webhooks, portal, free tier, coupons
- **email.js** (89 linhas): Brevo SMTP, 5 templates
- **node-health.js** (79 linhas): monitor 60s
- **provisioning.js** (77 linhas): selectNode + criar tenant no nó
- **auth.js** (46 linhas): JWT admin

---

## 7. Estrutura do Repositório

```
flac-guard-control/
├── docker-compose.yml
├── server/src/
│   ├── index.js
│   ├── db/ (schema.sql, pool.js, migrate.js)
│   ├── routes/
│   │   ├── gateway-auth.js          ⏳
│   │   ├── gateway-cameras.js       ⏳
│   │   ├── gateway-recordings.js    ⏳
│   │   ├── gateway-faces.js         ⏳
│   │   ├── gateway-pdvs.js          ⏳
│   │   ├── gateway-events.js        ⏳
│   │   ├── gateway-monitor.js       ⏳
│   │   ├── admin-deploy.js          ⏳ deploy multi-nó
│   │   ├── billing.js               ✅
│   │   ├── admin-tenants.js         ✅
│   │   ├── admin-nodes.js           ✅
│   │   ├── admin-dashboard.js       ✅
│   │   ├── admin-billing.js         ✅
│   │   ├── admin-auth.js            ✅
│   │   ├── internal.js              ✅
│   │   └── plans.js                 ✅
│   ├── services/
│   │   ├── gateway.js               ⏳
│   │   ├── cloudflare.js            ⏳
│   │   ├── deploy.js                ⏳
│   │   ├── stripe.js                ✅ (304 linhas)
│   │   ├── contabo.js               ✅ (⏳ evoluir cloud-init)
│   │   ├── email.js                 ✅
│   │   ├── provisioning.js          ✅
│   │   ├── node-health.js           ✅
│   │   └── auth.js                  ✅
│   └── scripts/
│       ├── stripe-sync-plans.js     ✅
│       └── stripe-setup-webhook.js  ✅
├── client-dashboard/                ⏳ Dashboard CLIENTE (React)
├── dashboard-admin/                 ✅ Dashboard ADMIN (5 páginas)
├── landing/                         ✅ Site comercial (4 páginas)
└── deploy/
    ├── nginx-host.conf              ✅
    ├── setup-ssl.sh                 ✅
    └── ssl-hardening.conf           ✅
```

---

## 8. Nginx (Control)

```nginx
guard.flactech.com.br   → :3000 (client-dashboard)
flactech.com.br         → :3002 (landing)
app.flactech.com.br     → :3001 (admin-dashboard)
Todos: /api/ → :8000    (API)
```

Rate limiting: 30r/s API, 5r/m auth. Security headers. SSL hardening.

---

## 9. Ordem de Implementação

### Fase 3: Control multi-nó (~4h)
- Migration: tenant_nodes + camera_node_map + deploy_log
- services/cloudflare.js
- Evoluir contabo.js (cloud-init completo)
- services/deploy.js + routes/admin-deploy.js
- Deploy status no admin dashboard (Nodes.jsx)

### Fase 4: Gateway (~6h)
- services/gateway.js
- 7 routes gateway-*.js (cameras, recordings, faces, pdvs, events, monitor, auth)

### Fase 5: Dashboard cliente (~4h)
- client-dashboard/ (clonar/adaptar do nó)
- URLs absolutas HLS/S3
- Auth via gateway

### Restante
- Fase 6: Ajustes Stripe para multi-nó (~2h)
- Fase 7: Landing ajustes (~1h)
- Fase 8: Email + DNS (~2h)
- Fase 9: HappyDo go-live (~3h)
