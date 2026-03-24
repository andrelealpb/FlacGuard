# Flac Guard — Arquitetura do Sistema

> Versão 7.0 | Março 2026
> Gerado a partir do código-fonte dos repos FlacGuard + flac-guard-control
> Domínio: flactech.com.br (registro Registro.br, DNS a migrar para Cloudflare)
> Status: Nó em produção (5 câmeras) + Control em implementação inicial

---

## 1. Visão Geral

O Flac Guard é um SaaS de vídeo monitoramento com reconhecimento facial para mercadinhos autônomos. Composto por dois sistemas:

**Control** (`flac-guard-control`) — ponto único de acesso. Serve dashboard admin, gerencia billing (Stripe), licensing, provisioning de nós (Contabo API). Futuro: dashboard unificado do cliente + gateway JSON multi-nó.

**Nó de processamento** (`FlacGuard`) — recebe streams RTMP, grava, processa facial, armazena no S3. Cada nó VPS 30 suporta ~40 câmeras. Um tenant pode ter múltiplos nós.

**Princípio:** Control só trafega JSON. Vídeo ao vivo (HLS) vai direto do browser para o nó. Playback vai direto do browser para o S3.

### Números em produção

| Métrica | Valor |
|---------|-------|
| Câmeras online | 5/5 |
| PDVs monitorados | 3 |
| Face embeddings | 51.364+ |
| S3 usado | 22.3 GB |
| Gravações no S3 | 3.360 |
| CPU (5 câmeras) | 23% de 6 vCPU |
| RAM | 2.2 GB de 11.7 GB |
| Uptime | 3d 16h+ |

---

## 2. Stack Completa

### Nó de processamento (96 arquivos, ~12.000 linhas)

| Componente | Tecnologia |
|-----------|-----------|
| Servidor RTMP | Nginx-RTMP (Docker) |
| API Backend | Node.js 20 + Express 4 (ESM) |
| Banco de Dados | PostgreSQL 16 + pgvector (imagem pgvector/pgvector:pg16) |
| Face Service | Python 3.11 + InsightFace buffalo_l + YOLO26n (FastAPI/Uvicorn) |
| Object Storage | Contabo S3 (@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner) |
| Dashboard | React 18 + TypeScript + Vite + HLS.js (10 páginas) |
| CI/CD | GitHub webhook → deploy.sh (auto-deploy on push) |

### Control (47 arquivos, ~3.500 linhas)

| Componente | Tecnologia |
|-----------|-----------|
| API | Node.js 20 + Express (ESM) |
| Banco de Dados | PostgreSQL 16 Alpine |
| Billing | Stripe SDK v17 (subscriptions, checkout, webhooks, portal) |
| Email transacional | Brevo SMTP + nodemailer |
| Provisioning VPS | Contabo API (REST + OAuth2) |
| Dashboard admin | React (JSX) + Vite (5 páginas) |
| Landing page | HTML/CSS estático (4 páginas) |
| Scripts | stripe-sync-plans.js, stripe-setup-webhook.js |

---

## 3. Infraestrutura

### Nó #1 (em produção)

| Recurso | Detalhe |
|---------|---------|
| Plano | Cloud VPS 20 NVMe (US-Central) |
| IP | 147.93.141.133 |
| Specs | 6 vCPU, 12 GB RAM, 100 GB NVMe |
| Custo | $6.36/mês |
| Containers | 5 (nginx-rtmp, api, face-service, dashboard, db) |

### Object Storage

| Recurso | Detalhe |
|---------|---------|
| Bucket | FlacGuard-S3 (US-Central) |
| Capacidade | 250 GB base ($2.99/mês), auto-scaling disponível |
| Uso atual | 22.3 GB (7.76%) |
| Endpoint | https://usc1.contabostorage.com |

### DNS atual (Registro.br)

```
A   api-guard.flactech.com.br      147.93.141.133
A   deploy-guard.flactech.com.br   147.93.141.133
A   guard.flactech.com.br          147.93.141.133
A   hls-guard.flactech.com.br      147.93.141.133
A   rtmp-guard.flactech.com.br     147.93.141.133
A   ssh-guard.flactech.com.br      147.93.141.133
```

### Email

| Serviço | Função |
|---------|--------|
| Google Workspace | Corporativo (@flactech.com.br) |
| Brevo SMTP | Transacional (noreply@flactech.com.br) |

---

## 4. Nó — Docker Compose (5 containers)

```yaml
services:
  nginx-rtmp:     # :1935 RTMP + :8080 HLS/stats
  api:            # :8000 Express + 7 serviços background + routes/internal.js
  face-service:   # :8001 InsightFace + YOLO (limite 2GB RAM)
  dashboard:      # :3000 React SPA (Nginx Alpine)
  db:             # :5432 pgvector/pgvector:pg16

volumes: pgdata, hls_data, recordings
```

### Migrations (11 arquivos)

| # | Arquivo | Função |
|---|---------|--------|
| 001 | pdvs_pulse_fields.sql | Campos Pulse + constraint modelos câmera |
| 002 | settings_table.sql | Tabela settings (key-value) |
| 003 | camera_recording_settings.sql | recording_mode, retention_days, motion_sensitivity |
| 004 | face_recognition.sql | face_embeddings (HNSW 512D), watchlist, alerts, visitors, audit |
| 005 | face_person_linking.sql | person_id em face_embeddings |
| 006 | alerts_and_storage_quota.sql | system_alerts + storage_quota_gb |
| 007 | camera_purpose.sql | camera_purpose (environment/face) + capture_face |
| 008 | multi_tenant.sql | Tabela tenants + tenant_id em pdvs, cameras, users, api_keys, webhooks, face_watchlist |
| 008 | persons.sql | Tabela persons (perfis nomeados a partir de embeddings agrupados) |
| 009 | s3_storage.sql | s3_key em recordings, face_embeddings, watchlist |
| 010 | internal_api_tenant_fields.sql | max_pdvs, max_cameras_per_pdv, free_facial_per_pdv, retention_days, features em tenants |

### Serviços Background (7)

| Serviço | Intervalo | Função |
|---------|-----------|--------|
| Motion Detector | 3-4s/câmera | Frame HLS → pixel diff → YOLO → InsightFace → pgvector → watchlist |
| Continuous Recorder | 30s | Gerencia gravação contínua (segmentos 15min) |
| Visitor Counter | 10 min | Visitantes distintos/câmera/dia (embedding-based) |
| Cleanup | 1 hora | Deleta gravações expiradas do S3 e disco |
| Disk Monitor | 15 min | Alertas 85%/90%, quota por câmera |
| Camera Health | 60s | Marca offline se sem heartbeat 90s |
| Face Service Check | 30s | Verifica disponibilidade InsightFace |

### Routes do Nó (3.528 linhas)

| Route | Linhas | Função |
|-------|:------:|--------|
| faces.js | 986 | Search, watchlist CRUD, **persons CRUD** (criar, listar, buscar, add embeddings, link watchlist), alerts, visitors, reimport |
| monitor.js | 594 | System stats, **S3 health check detalhado**, S3 migration (start/pause/resume/cancel), **Docker cleanup remoto** |
| cameras.js | 474 | CRUD, live, recordings, snapshot, download, **stream-names**, **disk-usage por câmera** |
| recordings.js | 432 | Playback (S3/local), cleanup, detect-faces, search-face, **thumbnails (on-the-fly via FFmpeg)** |
| internal.js | 268 | Endpoints para Control (health, tenants CRUD, limits, usage) |
| pdvs.js | 242 | Lista, sync Pulse, **pulse-status**, **CRUD PDVs**, **visitors por PDV** |
| hooks.js | 138 | Callbacks Nginx RTMP (on_publish, on_publish_done) |
| settings.js | 111 | Config Pulse, RTMP host |
| pdvs.js | 242 | Lista, sync Pulse, CRUD, visitors/PDV |
| alerts.js | 94 | System alerts |
| auth.js | 84 | Login, setup, register |
| events.js | 53 | Listar eventos |
| webhooks.js | 52 | CRUD webhooks |

### Endpoints internos (routes/internal.js) — **IMPLEMENTADO**

Auth: `X-Internal-Key` (timing-safe compare). Env: `INTERNAL_API_KEY`.

```
GET    /api/internal/health              # Health check do nó
POST   /api/internal/tenants             # Criar tenant (gera admin + password)
DELETE /api/internal/tenants/:id         # Desativar tenant + users + api_keys
PUT    /api/internal/tenants/:id/limits  # Atualizar max_pdvs, retention, features
GET    /api/internal/tenants/:id/usage   # cameras_online, pdv_count, storage_used_gb
```

### Services do Nó (2.365 linhas)

| Service | Função |
|---------|--------|
| tenant.js | getTenantId, tenantFilter, getTenantSlug, getTenantBySlug |
| storage.js | S3 upload/download/delete/presign/list (213 linhas) |
| s3-migration.js | Batch migration local→S3 (start/pause/resume/cancel, 153 linhas) |
| motion-detector.js | Pipeline unificado (pixel diff + YOLO + InsightFace) |
| recorder.js | FFmpeg gravação + upload S3 (223 linhas) |
| recording.js | Queries de busca por período/timestamp |
| face-recognition.js | Client face-service, busca pgvector, visitors |
| cleanup.js | Retenção + S3 delete (129 linhas) |
| disk-monitor.js | Alertas, quotas |
| health.js | Câmera offline detection |
| rtmp.js | URLs RTMP/HLS |
| pulse.js | Client HappyDoPulse (sync PDVs) |
| auth.js | JWT, bcrypt, API Key, tenant extraction |

### Dashboard do Nó (5.898 linhas, 10 páginas)

| Página | Linhas | Função |
|--------|:------:|--------|
| Playback.tsx | 1.528 | Timeline, player, face detection em frames, **criar pessoa de embeddings**, **add embedding a pessoa existente** |
| Cameras.tsx | 1.136 | CRUD, config RTMP, modo, retenção, purpose, quota, **disk-usage por câmera**, **stream-names** |
| Monitoring.tsx | 628 | CPU, RAM, disco, rede, Docker, **S3 health card detalhado**, **S3 migration UI**, **Docker cleanup remoto**, **disk breakdown** |
| Settings.tsx | 610 | Pulse config, deploy status, RTMP host, S3 migration |
| FaceSearch.tsx | 597 | Busca facial, watchlist, **tab Persons (listar, criar, deletar, buscar por pessoa, add to watchlist)** |
| Visitors.tsx | 358 | Visitantes/PDV/dia |
| Stats.tsx | 267 | RTMP real-time (bandwidth, streams, codecs) |
| Live.tsx | 237 | Mosaico HLS, filtro online/offline, grid ajustável |
| Login.tsx | 188 | Auth + setup primeiro admin |
| PDVs.tsx | 101 | Lista PDVs com câmeras online/offline |

---

## 5. Control — Docker Compose (4 containers)

```yaml
services:
  api:        # :8000 Express (billing, admin, internal)
  dashboard:  # :3000 Admin dashboard (React/JSX)
  landing:    # :3001 Site comercial (HTML estático)
  db:         # PostgreSQL 16 Alpine

volumes: pgdata
```

### Schema do Control

```
plans               # 4 planos: tester, monitoring, advanced, ultra
nodes               # Nós de processamento (host, api_key, max_cameras, status)
tenants             # Clientes SaaS (plan_id, node_id, stripe IDs, status)
admin_users         # Admins do Control
billing_events      # Log de eventos Stripe
node_health_log     # Histórico saúde dos nós
_migrations         # Tracking de migrations
```

**Nota:** O schema atual tem `tenants.node_id` (1:1). Para multi-nó precisa evoluir para tabela `tenant_nodes` (N:N) + `camera_node_map`.

### Routes do Control (775 linhas)

| Route | Linhas | Função |
|-------|:------:|--------|
| admin-tenants.js | 177 | CRUD tenants com provisioning |
| internal.js | 147 | Nós reportam usage/health |
| admin-nodes.js | 125 | CRUD nós, provision, health |
| billing.js | 83 | Stripe checkout, webhook, portal |
| admin-billing.js | 74 | Relatórios MRR, receita |
| admin-dashboard.js | 74 | KPIs (tenants, câmeras, receita) |
| admin-auth.js | 70 | Login admin, setup |
| plans.js | 25 | GET /api/plans (público) |

### Services do Control (674 linhas)

| Service | Linhas | Função |
|---------|:------:|--------|
| stripe.js | 304 | Checkout sessions (per-unit + free tier), webhooks (7 eventos), portal, update quantity, coupon support |
| email.js | 89 | Brevo SMTP + nodemailer (welcome, trial_expiring, payment_failed, invoice_paid, suspended) |
| contabo.js | 79 | Contabo API OAuth2 + VPS provisioning (VPS 30 default, cloud-init) |
| node-health.js | 79 | Monitor saúde nós a cada 60s |
| provisioning.js | 77 | selectNode + criar tenant no nó via API interna |
| auth.js | 46 | JWT + bcrypt para admin |

### Scripts

| Script | Função |
|--------|--------|
| stripe-sync-plans.js | Cria/atualiza products + prices no Stripe a partir dos planos do banco |
| stripe-setup-webhook.js | Configura webhook endpoint no Stripe |

### Landing page (4 páginas)

| Página | Linhas | Função |
|--------|:------:|--------|
| index.html | 381 | Site comercial |
| pricing.html | 410 | Planos com CTA → checkout |
| checkout.html | 309 | Formulário de contratação (câmeras, plano) → Stripe |
| welcome.html | 47 | Pós-checkout success |

### Admin Dashboard (5 páginas)

| Página | Linhas | Função |
|--------|:------:|--------|
| Tenants.jsx | 303 | Lista/detalhe tenants, criar, ativar/suspender |
| Nodes.jsx | 318 | Lista nós, capacidade, saúde, provisionar |
| Login.jsx | 171 | Login admin |
| Billing.jsx | 112 | MRR, receita, eventos |
| Dashboard.jsx | 108 | KPIs: total tenants, câmeras, MRR, nós |

### Nginx do Control

Rate limiting (30r/s API, 5r/m auth), security headers, SSL hardening, upstreams para api/dashboard/landing. Stripe webhook sem rate limit.

---

## 6. Multi-tenant

### No nó (implementado)

Tabela `tenants` com `tenant_id` em pdvs, cameras, users, api_keys, webhooks, face_watchlist. Migration 010 adicionou campos de plano (max_pdvs, max_cameras_per_pdv, retention_days, features JSONB).

### No Control (implementado parcial)

Tabela `tenants` com `node_id` (1:1 — um tenant em um nó). Para multi-nó, precisa evoluir para `tenant_nodes` (N:N).

### Stream keys

Prefixo com slug do tenant: `happydo_<random>`.

---

## 7. Face Service

InsightFace buffalo_l (~300MB) + YOLO26n (~12MB). FastAPI/Uvicorn, limite 2GB RAM.

### Two-pass detection

1. Detecção direta (threshold 0.3)
2. Se nenhum rosto → YOLO localiza pessoas → crop upper body 50% → retry (threshold 0.2)

### Persons (Migration 008_persons) — **IMPLEMENTADO**

Tabela `persons`: perfis nomeados construídos a partir de embeddings agrupados. Uma pessoa é identificada por TODOS os seus embeddings (diferentes aparências: roupas, chapéu, cabelo, etc.), não apenas uma foto.

API completa:
- CRUD persons (criar, listar, detalhe, atualizar, deletar)
- Criar pessoa a partir de embedding específico (`POST /faces/persons/from-embedding`)
- Adicionar embeddings a pessoa existente (`POST /faces/persons/:id/add-embeddings`)
- Buscar aparições de pessoa em todas câmeras (`POST /faces/persons/:id/search`)
- Linkar pessoa a watchlist (`POST /faces/persons/:id/watchlist`)
- Dashboard: tab "Persons" no FaceSearch, botão "Criar Pessoa" no Playback ao detectar rostos

---

## 8. Object Storage (S3)

Fluxo: FFmpeg grava local → INSERT banco → upload S3 (`recordings/{tenant}/{camera}/{date}/{file}`) → UPDATE s3_key → DELETE local.

Playback: se s3_key → pre-signed URL (1h) → redirect 302. Senão → disco local.

S3 migration: batch com concurrency 5, start/pause/resume/cancel, progresso no dashboard.

---

## 9. Billing (Stripe)

### Produtos

4 planos com per-unit pricing (R$/câmera/mês). Free tier (Tester) cria tenant direto sem checkout.

### Webhooks processados

| Evento | Ação |
|--------|------|
| checkout.session.completed | Criar tenant + provisionar no nó |
| invoice.paid | Ativar subscription |
| invoice.payment_failed | Grace period → email |
| customer.subscription.updated | Atualizar plano/quantidade |
| customer.subscription.deleted | Desativar tenant |
| customer.subscription.trial_will_end | Email de aviso |
| invoice.finalized | Log |

### Features

- Allow promotion codes (cupons)
- Customer portal self-service
- Subscription update com proration
- Free tier sem checkout (criação direta)

---

## 10. Segurança

- Stream keys com prefixo tenant, validadas via callback Nginx
- JWT com tenant_id + roles (admin, operator, viewer)
- API Key com tenant_id para integrações server-to-server
- Internal API: X-Internal-Key com timing-safe compare
- Rate limiting: 30r/s API, 5r/m auth (Nginx), 200r/min (Express)
- Busca facial: admin only + audit log (LGPD)
- S3: pre-signed URLs com expiração 1h
- Nginx: security headers (HSTS, X-Frame-Options, X-Content-Type-Options)
- Stripe: webhook signature verification
- Deploy webhook: HMAC-SHA256

---

## 11. CI/CD

### Nó

Push GitHub (main) → webhook :9000 → deploy.sh: git pull → docker compose build → up -d → health check → deploy-status.json. Self-update detection.

### Control

SSL setup script (deploy/setup-ssl.sh) + Nginx hardening (deploy/ssl-hardening.conf).

---

## 12. Estrutura dos Repositórios

### FlacGuard (nó) — 96 arquivos

```
FlacGuard/
├── docker-compose.yml           # 5 containers
├── server/
│   ├── nginx-rtmp/              # RTMP + HLS + callbacks
│   ├── api/src/
│   │   ├── index.js             # Bootstrap + 7 background services
│   │   ├── db/migrations/       # 001-010 (11 arquivos)
│   │   ├── routes/
│   │   │   ├── internal.js      # ✅ Endpoints para Control (268 linhas)
│   │   │   ├── cameras.js       # CRUD + live + recordings
│   │   │   ├── recordings.js    # Playback + S3 migration
│   │   │   ├── faces.js         # Search + watchlist + visitors
│   │   │   ├── hooks.js         # Callbacks Nginx RTMP
│   │   │   └── ... (12 route files total)
│   │   └── services/
│   │       ├── tenant.js, storage.js, s3-migration.js
│   │       ├── motion-detector.js, recorder.js, face-recognition.js
│   │       ├── cleanup.js, disk-monitor.js, health.js
│   │       └── ... (13 service files total)
│   ├── face-service/            # Python + InsightFace + YOLO
│   └── recorder/                # FFmpeg segment (alternativo)
├── dashboard/src/pages/         # 10 páginas React TypeScript
├── agent/                       # Pi Zero RTSP→RTMP bridge
├── deploy/                      # Webhook + deploy.sh + systemd
└── docs/                        # 12 documentos
```

### flac-guard-control — 47 arquivos

```
flac-guard-control/
├── docker-compose.yml           # 4 containers (api, dashboard, landing, db)
├── server/src/
│   ├── index.js                 # Bootstrap + health monitor
│   ├── db/schema.sql            # plans, nodes, tenants, admin_users, billing, health
│   ├── routes/
│   │   ├── billing.js           # Stripe checkout + webhook + portal
│   │   ├── admin-tenants.js     # CRUD tenants + provisioning
│   │   ├── admin-nodes.js       # CRUD nós + provision
│   │   ├── admin-dashboard.js   # KPIs
│   │   ├── admin-billing.js     # Relatórios MRR
│   │   ├── admin-auth.js        # Login/setup admin
│   │   ├── internal.js          # Nós → Control (usage/health)
│   │   └── plans.js             # GET planos (público)
│   ├── services/
│   │   ├── stripe.js            # 304 linhas, checkout + webhooks + portal
│   │   ├── email.js             # Brevo SMTP, 5 templates
│   │   ├── contabo.js           # Contabo API, cloud-init
│   │   ├── provisioning.js      # selectNode + criar tenant no nó
│   │   ├── node-health.js       # Monitor 60s
│   │   └── auth.js              # JWT admin
│   └── scripts/
│       ├── stripe-sync-plans.js
│       └── stripe-setup-webhook.js
├── dashboard-admin/src/pages/   # 5 páginas React JSX
├── landing/                     # 4 páginas HTML
└── deploy/                      # nginx-host.conf, setup-ssl.sh, ssl-hardening.conf
```

---

## 13. Planos SaaS

| Plano | Preço/câmera | PDVs | Câm/PDV | Retenção | Video Search | Visitors | ERP |
|-------|:-----------:|:----:|:-------:|:--------:|:---:|:---:|:---:|
| Tester | Grátis (30d) | 1 | 2 | 14 dias | ❌ | ❌ | ❌ |
| Monitoring | R$ 49,90 | 30 | 3 | 21 dias | ✅ | ✅ | ❌ |
| Advanced | R$ 59,90 | 100 | 3 | 21 dias | ✅ | ✅ | ✅ |
| Ultra | R$ 44,90 | 300 | 3 | 21 dias | ✅ | ✅ | ✅ |

Cobrança por câmera ativa + 1 facial grátis/PDV. Stripe per-unit.

---

## 14. Roadmap

### Concluído ✅

- [x] Nó completo: RTMP, gravação, motion detection, face recognition, S3, multi-tenant
- [x] Endpoints internos no nó (routes/internal.js, 268 linhas)
- [x] Migration 010: campos de plano no tenants do nó
- [x] Control: schema + API admin + auth + billing (Stripe) + email + provisioning
- [x] Control: admin dashboard (5 páginas) + landing page (4 páginas)
- [x] Control: Stripe integration completa (checkout, webhooks, portal, free tier, coupons)
- [x] Control: Contabo API (provisionar VPS 30 + cloud-init)
- [x] Control: Nginx config com rate limiting + SSL hardening
- [x] Scripts: stripe-sync-plans, stripe-setup-webhook

### Em implementação / Próximos

- [ ] **Migrar DNS para Cloudflare** (API para criar node-N.flactech.com.br automaticamente)
- [ ] **services/cloudflare.js** no Control (criar/deletar DNS records)
- [ ] **Dashboard cliente unificado** no Control (gateway multi-nó, vídeo direto nó/S3)
- [ ] **tenant_nodes (N:N)** + camera_node_map no Control (multi-nó por tenant)
- [ ] **HTTPS nos nós** (Certbot node-N.flactech.com.br, CORS guard.flactech.com.br)
- [ ] Remover dashboard do docker-compose do nó (após dashboard cliente no Control)
- [ ] Provisionar VPS Control (VPS 10) + deploy
- [ ] HappyDo go-live: 4× VPS 30, 154 câmeras, S3 auto-scaling 2.5 TB

### Pendências (não bloqueiam SaaS)

- Endpoints snapshot e download no nó (retornam 501)
- Miniaturas na timeline
- Push notifications / alertas de watchlist via webhook
- App mobile (Guard Cam, Kotlin)
- Migração S3 → Backblaze B2 + Cloudflare CDN
- CRUD de API Keys (tabela existe, endpoints não)
