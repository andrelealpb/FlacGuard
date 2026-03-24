# flac-guard-control — Documento Técnico (v2)

> Repositório: `github.com/andrelealpb/flac-guard-control`
> VPS: Cloud VPS 10 Contabo ($3.96/mês, 4 cores, 8GB, US-Central)
> Domínio: flactech.com.br (registro Registro.br, DNS Cloudflare)
> Função: Dashboard cliente unificado, gateway JSON, licensing, billing, provisioning
> Princípio: Control só trafega JSON — vídeo vai direto nó/S3

---

## 1. Visão Geral

O Control é o ponto único de acesso do SaaS. Serve o dashboard React para o cliente, faz gateway JSON para os nós (consulta em paralelo, merge), e gerencia licensing/billing/provisioning.

**Nunca trafega vídeo.** Live (HLS) vai direto do browser para o nó. Playback vai direto do browser para o S3. O Control retorna URLs absolutas que o browser usa para conectar diretamente.

### O que o Control faz

- Dashboard do cliente (guard.flactech.com.br) — React SPA
- Gateway API — proxy JSON para nós, consolida resultados
- Retorna URLs de vídeo apontando direto para nó/S3
- Licensing — tenants, planos, limites
- Billing — Stripe subscriptions
- Provisioning — Contabo API (VPS) + Cloudflare API (DNS) + Certbot (SSL)
- Landing page — flactech.com.br
- Admin dashboard — app.flactech.com.br
- Health monitor — saúde dos nós
- Email transacional — Brevo SMTP

### O que o Control NÃO faz

- Receber RTMP
- Processar vídeo/facial
- Proxy de streams HLS
- Proxy de playback MP4/S3

### Pré-requisitos concluídos ✅

Nó #1 (147.93.141.133): multi-tenant, S3, face recognition, 5 câmeras ativas.

---

## 2. Stack

| Componente | Tecnologia |
|-----------|-----------|
| API + Gateway | Node.js 20 + Express (ESM) |
| Dashboard cliente | React 18 + TypeScript + Vite |
| Dashboard admin | React 18 + TypeScript + Vite |
| Landing page | HTML/CSS/JS estático |
| Banco | PostgreSQL 16 |
| Billing | Stripe SDK |
| DNS automático | Cloudflare API |
| Email corporativo | Google Workspace (@flactech.com.br) |
| Email transacional | Brevo SMTP + nodemailer |
| Provisioning VPS | Contabo API (REST) |
| Proxy/SSL | Nginx + Let's Encrypt |
| Containers | Docker Compose (5 containers) |

---

## 3. Docker Compose

```yaml
name: flac-guard-control

services:
  api:
    build: ./server
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://flac_control:flac_control@db:5432/flac_control
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - BREVO_SMTP_HOST=${BREVO_SMTP_HOST:-smtp-relay.brevo.com}
      - BREVO_SMTP_PORT=${BREVO_SMTP_PORT:-587}
      - BREVO_SMTP_USER=${BREVO_SMTP_USER}
      - BREVO_SMTP_PASS=${BREVO_SMTP_PASS}
      - EMAIL_FROM=${EMAIL_FROM:-noreply@flactech.com.br}
      - EMAIL_REPLY_TO=${EMAIL_REPLY_TO:-suporte@flactech.com.br}
      - CONTABO_API_CLIENT_ID=${CONTABO_API_CLIENT_ID}
      - CONTABO_API_CLIENT_SECRET=${CONTABO_API_CLIENT_SECRET}
      - CONTABO_API_USER=${CONTABO_API_USER}
      - CONTABO_API_PASSWORD=${CONTABO_API_PASSWORD}
      - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
      - CLOUDFLARE_ZONE_ID=${CLOUDFLARE_ZONE_ID}
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  client-dashboard:
    build: ./client-dashboard
    ports:
      - "3000:3000"
    restart: unless-stopped

  admin-dashboard:
    build: ./admin-dashboard
    ports:
      - "3001:3001"
    restart: unless-stopped

  landing:
    build: ./landing
    ports:
      - "3002:80"
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=flac_control
      - POSTGRES_PASSWORD=flac_control
      - POSTGRES_DB=flac_control
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flac_control"]
      interval: 5s
    restart: unless-stopped

volumes:
  pgdata:
```

---

## 4. Schema do Banco

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Planos
CREATE TABLE plans (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(50)  NOT NULL UNIQUE,
  display_name          VARCHAR(100) NOT NULL,
  max_pdvs              INTEGER      NOT NULL,
  max_cameras_per_pdv   INTEGER      NOT NULL DEFAULT 3,
  free_facial_per_pdv   INTEGER      NOT NULL DEFAULT 1,
  retention_days        INTEGER      NOT NULL DEFAULT 21,
  has_video_search      BOOLEAN      NOT NULL DEFAULT false,
  has_visitors          BOOLEAN      NOT NULL DEFAULT false,
  has_erp_integration   BOOLEAN      NOT NULL DEFAULT false,
  price_per_camera_brl  NUMERIC(8,2) NOT NULL DEFAULT 0,
  trial_days            INTEGER      NOT NULL DEFAULT 0,
  stripe_product_id     VARCHAR(100),
  stripe_price_id       VARCHAR(100),
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  sort_order            INTEGER      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO plans (name, display_name, max_pdvs, max_cameras_per_pdv, retention_days,
  has_video_search, has_visitors, has_erp_integration,
  price_per_camera_brl, trial_days, sort_order)
VALUES
  ('tester',     'Tester',     1,   2,  14, false, false, false, 0,     30, 1),
  ('monitoring', 'Monitoring', 30,  3,  21, true,  true,  false, 49.90, 0,  2),
  ('advanced',   'Advanced',   100, 3,  21, true,  true,  true,  59.90, 0,  3),
  ('ultra',      'Ultra',      300, 3,  21, true,  true,  true,  44.90, 0,  4);

-- Nós de processamento
CREATE TABLE nodes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                VARCHAR(100) NOT NULL,
  host                VARCHAR(255) NOT NULL,     -- node-N.flactech.com.br
  ip_address          VARCHAR(45),               -- IP direto (backup)
  rtmp_port           INTEGER      NOT NULL DEFAULT 1935,
  api_port            INTEGER      NOT NULL DEFAULT 8000,
  hls_port            INTEGER      NOT NULL DEFAULT 8080,
  api_key             VARCHAR(100) NOT NULL,
  max_cameras         INTEGER      NOT NULL DEFAULT 40,
  current_cameras     INTEGER      NOT NULL DEFAULT 0,
  vps_tier            VARCHAR(20)  NOT NULL DEFAULT 'vps30',
  region              VARCHAR(50)  NOT NULL DEFAULT 'us-central',
  contabo_instance_id VARCHAR(100),
  cloudflare_record_id VARCHAR(100),             -- para deletar DNS se aposentar nó
  is_shared           BOOLEAN      NOT NULL DEFAULT false,
  ssl_provisioned     BOOLEAN      NOT NULL DEFAULT false,
  status              VARCHAR(20)  NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'provisioning', 'maintenance', 'retired')),
  last_health_at      TIMESTAMPTZ,
  health_data         JSONB        DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Tenants
CREATE TABLE tenants (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   VARCHAR(255) NOT NULL,
  slug                   VARCHAR(100) NOT NULL UNIQUE,
  email                  VARCHAR(255) NOT NULL,
  phone                  VARCHAR(20),
  company_name           VARCHAR(255),
  cnpj                   VARCHAR(20),
  plan_id                UUID         NOT NULL REFERENCES plans(id),
  stripe_customer_id     VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  status                 VARCHAR(20)  NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'suspended')),
  trial_ends_at          TIMESTAMPTZ,
  total_cameras          INTEGER      NOT NULL DEFAULT 0,
  total_pdvs             INTEGER      NOT NULL DEFAULT 0,
  billable_cameras       INTEGER      NOT NULL DEFAULT 0,
  settings               JSONB        DEFAULT '{}',
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Tenant ↔ Nós (N:N)
CREATE TABLE tenant_nodes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID    NOT NULL REFERENCES tenants(id),
  node_id          UUID    NOT NULL REFERENCES nodes(id),
  camera_slots     INTEGER NOT NULL DEFAULT 40,
  assigned_cameras INTEGER NOT NULL DEFAULT 0,
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, node_id)
);

-- Câmera → Nó (qual câmera está em qual nó)
CREATE TABLE camera_node_map (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id),
  node_id     UUID         NOT NULL REFERENCES nodes(id),
  camera_id   UUID         NOT NULL,  -- ID da câmera no banco do nó
  camera_name VARCHAR(255),
  pdv_name    VARCHAR(255),
  stream_key  VARCHAR(100),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, camera_id)
);

-- Admin users
CREATE TABLE admin_users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  hashed_password VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'admin',
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Billing events
CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id),
  stripe_event_id VARCHAR(100) UNIQUE,
  event_type      VARCHAR(100) NOT NULL,
  amount_brl      NUMERIC(10,2),
  metadata        JSONB        DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Node health log
CREATE TABLE node_health_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  node_id        UUID    NOT NULL REFERENCES nodes(id),
  cpu_percent    INTEGER,
  mem_percent    INTEGER,
  disk_percent   INTEGER,
  cameras_online INTEGER,
  cameras_total  INTEGER,
  response_ms    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_nodes_tenant ON tenant_nodes(tenant_id);
CREATE INDEX idx_camera_node_tenant ON camera_node_map(tenant_id);
CREATE INDEX idx_camera_node_node ON camera_node_map(node_id);
CREATE INDEX idx_node_health ON node_health_log(node_id, created_at DESC);
```

---

## 5. API — Endpoints

### Gateway (dashboard do cliente)

Retorna JSON consolidado de N nós. URLs de vídeo apontam direto para nó/S3.

```
POST   /api/auth/login              # JWT com tenant_id
POST   /api/auth/setup              # Primeiro admin do tenant

GET    /api/cameras                  # Merge de todos os nós
POST   /api/cameras                  # Seleciona nó → cria no nó → registra camera_node_map
PUT    /api/cameras/:id              # Proxy para nó da câmera
DELETE /api/cameras/:id

GET    /api/cameras/:id/live         # Retorna { hls_url: "https://node-N.flactech.com.br/hls/..." }
                                     # Browser conecta DIRETO no nó

GET    /api/recordings               # Merge de todos os nós
GET    /api/recordings/by-day        # Merge
GET    /api/recordings/:id/stream    # Retorna { url: "https://usc1.contabostorage.com/...?sig=..." }
                                     # Browser conecta DIRETO no S3

POST   /api/faces/search             # Distribui para TODOS os nós → merge por score
GET    /api/faces/watchlist           # Merge
POST   /api/faces/watchlist           # Replica em TODOS os nós
GET    /api/faces/visitors            # Merge
GET    /api/faces/alerts              # Merge

GET    /api/pdvs                     # Merge
POST   /api/pdvs/sync                # Sync em todos os nós
GET    /api/events                   # Merge
GET    /api/monitor/system           # Stats consolidados de N nós
```

### Public (landing page)

```
GET    /api/plans
POST   /api/billing/checkout
POST   /api/billing/webhook
GET    /api/billing/portal/:slug
```

### Admin

```
GET/POST/PUT  /api/admin/tenants
GET/POST      /api/admin/nodes
POST          /api/admin/nodes/provision
GET           /api/admin/billing/overview
GET           /api/admin/dashboard
POST          /api/admin/auth/login
```

### Internal (nós → control)

```
POST   /api/internal/nodes/:id/usage
POST   /api/internal/nodes/:id/health
```

---

## 6. Services

### services/gateway.js

Consulta nós em paralelo, merge resultados, proxy para nó específico, seleção de nó para nova câmera. Core do multi-nó.

### services/cloudflare.js

```javascript
/**
 * Cloudflare DNS API
 * Cria/deleta registros A para node-N.flactech.com.br
 */
const CF_API = 'https://api.cloudflare.com/client/v4';

export async function createNodeDNS(nodeName, ipAddress) {
  // POST /zones/{zone}/dns_records → A record node-N.flactech.com.br → IP
  // proxied: false (RTMP não funciona com proxy Cloudflare)
  // Retorna cloudflare_record_id (para deletar depois)
}

export async function deleteNodeDNS(recordId) {
  // DELETE /zones/{zone}/dns_records/{id}
}
```

### services/contabo.js

Provisiona VPS 30 via Contabo API + cloud-init (Docker + repo + containers).

### services/provisioning.js

Orquestra: Contabo API (VPS) → Cloudflare API (DNS) → aguarda propagação → Certbot (SSL) → registra node → registra tenant_nodes.

### services/stripe.js

Checkout sessions, webhooks, portal, update quantity.

### services/email.js

Brevo SMTP + nodemailer. Templates: welcome, trial_expiring, payment_failed, invoice_paid, suspended.

### services/node-health.js

Monitora todos os nós a cada 60s. Alertas se offline >5 min.

---

## 7. Dashboard do Cliente

Cópia adaptada do dashboard do FlacGuard. Diferenças:

| Aspecto | Dashboard do nó (atual) | Dashboard do Control (novo) |
|---------|------------------------|---------------------------|
| API base | localhost:8000/api | guard.flactech.com.br/api (gateway) |
| HLS URL | Relativa `/hls/key.m3u8` | Absoluta `https://node-N.flactech.com.br/hls/key.m3u8` |
| Playback | Relativa | Pre-signed URL do S3 (absoluta) |
| Auth | JWT do nó | JWT do Control |
| Câmeras | Banco local | Consolidado de N nós |

---

## 8. Nginx (host Control)

```nginx
server {
    listen 443 ssl;
    server_name guard.flactech.com.br;
    location / { proxy_pass http://localhost:3000; }
    location /api/ { proxy_pass http://localhost:8000; }
}

server {
    listen 443 ssl;
    server_name flactech.com.br www.flactech.com.br;
    location / { proxy_pass http://localhost:3002; }
    location /api/ { proxy_pass http://localhost:8000; }
}

server {
    listen 443 ssl;
    server_name app.flactech.com.br;
    location / { proxy_pass http://localhost:3001; }
    location /api/ { proxy_pass http://localhost:8000; }
}
```

---

## 9. Nginx (host Nó)

```nginx
server {
    listen 443 ssl;
    server_name node-1.flactech.com.br;

    # HLS — browser acessa direto (CORS para dashboard Control)
    location /hls/ {
        proxy_pass http://localhost:8080/hls/;
        add_header Access-Control-Allow-Origin "https://guard.flactech.com.br";
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
    }

    # API interna — só o Control acessa
    location /api/internal/ {
        proxy_pass http://localhost:8000/api/internal/;
    }

    # Tudo mais bloqueado
    location / { return 404; }
}
```

---

## 10. Estrutura do Repositório

```
flac-guard-control/
├── .env.example
├── docker-compose.yml
├── server/
│   └── src/
│       ├── index.js
│       ├── db/ (schema, pool, migrate)
│       ├── routes/
│       │   ├── gateway-auth.js
│       │   ├── gateway-cameras.js      # GET merge, POST seleciona nó
│       │   ├── gateway-recordings.js   # Retorna URLs diretas S3
│       │   ├── gateway-faces.js        # Search distribuído, watchlist replicada
│       │   ├── gateway-pdvs.js
│       │   ├── gateway-events.js
│       │   ├── gateway-monitor.js
│       │   ├── billing.js
│       │   ├── plans.js
│       │   ├── admin-*.js
│       │   └── internal.js
│       └── services/
│           ├── gateway.js              # queryAllNodes, merge, proxy, findCameraNode
│           ├── cloudflare.js           # Criar/deletar DNS A records
│           ├── contabo.js              # Provisionar VPS
│           ├── provisioning.js         # Orquestrar VPS + DNS + SSL
│           ├── stripe.js
│           ├── email.js
│           ├── node-health.js
│           └── auth.js
├── client-dashboard/                   # Dashboard CLIENTE (React)
│   └── src/pages/ (Live, Cameras, Playback, FaceSearch, Visitors, PDVs, Monitoring, Settings)
├── admin-dashboard/                    # Dashboard ADMIN (React)
│   └── src/pages/ (Dashboard, Tenants, Nodes, Billing)
├── landing/                            # Site comercial
│   ├── index.html
│   └── pricing.html
└── deploy/
```

---

## 11. Ordem de Implementação

### Fase 1: Infra (manual, ~2h)
- Provisionar VPS 10 (Control)
- Criar conta Cloudflare → migrar DNS de Registro.br
- Configurar registros DNS no Cloudflare
- Docker, Nginx, Certbot no Control
- Certbot no nó 1 (node-1.flactech.com.br)

### Fase 2: Endpoints internos no nó (Claude Code, repo FlacGuard, ~3h)
- routes/internal.js (auth X-Internal-Key)
- Todos os endpoints proxy (cameras, recordings, faces, pdvs, events, monitor)
- CORS para guard.flactech.com.br
- Nginx HTTPS no host do nó

### Fase 3: Control API base (Claude Code, repo flac-guard-control, ~4h)
- Schema + migrations + seeds (planos, nó 1, tenant happydo)
- Auth admin, CRUD plans/nodes/tenants

### Fase 4: Gateway multi-nó (Claude Code, ~6h)
- services/gateway.js
- Todos os gateway-*.js routes
- Live retorna URL HTTPS do nó
- Playback retorna pre-signed URL do S3

### Fase 5: Dashboard cliente (Claude Code, ~4h)
- Clonar/adaptar dashboard FlacGuard
- URLs absolutas para HLS e S3
- Auth via gateway

### Fase 6: Stripe (Claude Code, ~4h)
- Products + prices + checkout + webhooks

### Fase 7: Landing page (Claude Code, ~2h)
- Site comercial + Stripe Pricing Table

### Fase 8: Provisioning automático (Claude Code, ~4h)
- services/contabo.js + cloudflare.js + provisioning.js
- Auto-scaling (85% → provisionar)

### Fase 9: Email (manual + Claude Code, ~2h)
- Google Workspace + Brevo + DNS (MX, SPF, DKIM, DMARC no Cloudflare)
- services/email.js + templates

### Fase 10: HappyDo go-live (~3h)
- Upgrade VPS 20 → VPS 30 (ou manter como nó 1)
- Provisionar nós 2, 3, 4
- Distribuir 154 câmeras
- S3 auto-scaling cap 2.5 TB
- Testar dashboard unificado
