# Flac Guard — Arquitetura do Sistema

> Versão 5.0 | Março 2026
> Repositório: `github.com/andrelealpb/FlacGuard`
> Domínio: flactech.com.br
> Infra: Cloud VPS 20 NVMe (US-Central) + Contabo S3 (US-Central)
> Status: Produção (5 câmeras, multi-tenant, S3 ativo)

---

## 1. Visão Geral

O Flac Guard é um sistema SaaS de vídeo monitoramento com reconhecimento facial para mercadinhos autônomos. Recebe streams RTMP de câmeras Intelbras MIBO, grava por detecção de movimento ou continuamente, faz reconhecimento facial com InsightFace + YOLO26n, armazena gravações no Contabo S3, e oferece dashboard React com autenticação JWT multi-tenant.

A arquitetura é **RTMP-first** (câmeras fazem push outbound) e **multi-tenant** (múltiplos clientes isolados no mesmo servidor).

### Números atuais (produção)

| Métrica | Valor |
|---------|-------|
| Câmeras online | 5/5 |
| PDVs monitorados | 3 |
| Face embeddings | ~22.700+ |
| Gravações S3 | ~19 GB |
| Consumo médio/câmera | 0.53 GB/dia |
| Uptime servidor | 6+ dias contínuos |

### Stack

| Componente | Tecnologia | Linhas de código |
|-----------|-----------|:----------------:|
| Servidor RTMP | Nginx-RTMP (Docker) | — |
| API Backend | Node.js 20 + Express 4 (ESM) | ~5.100 |
| Face Service | Python 3.11 + InsightFace + YOLO26n (FastAPI) | ~290 |
| Dashboard | React 18 + TypeScript + Vite + HLS.js | ~5.100 |
| Banco de Dados | PostgreSQL 16 + pgvector | ~275 (migrations) |
| Object Storage | Contabo S3 (AWS SDK compatible) | — |
| CI/CD | GitHub webhook → deploy.sh | — |
| **Total** | **89 arquivos** | **~11.000+** |

---

## 2. Infraestrutura

### Docker Compose (5 containers)

```yaml
services:
  nginx-rtmp      # Porta 1935 (RTMP) + 8080 (HLS/stats)
  api             # Porta 8000 (Node.js + Express + FFmpeg)
  face-service    # Porta 8001 (Python + InsightFace + YOLO, limite 2GB RAM)
  dashboard       # Porta 3000 (React SPA via Nginx Alpine)
  db              # PostgreSQL 16 + pgvector, porta 5432
```

### VPS

- **Plano:** Cloud VPS 20 NVMe (Contabo, US-Central)
- **IP:** 147.93.141.133
- **Specs:** 6 cores, 12GB RAM, 100GB NVMe
- **Custo:** $10.75/mês
- **OS:** Ubuntu 24.04

### Object Storage

- **Provedor:** Contabo S3 (US-Central, mesma região do VPS)
- **Bucket:** FlacGuard-S3
- **Capacidade:** 250GB base, auto-scaling disponível
- **Uso atual:** 19.42 GB (7.76%)
- **Custo:** €2.49/mês
- **Prefixos:** `recordings/{tenant}/{camera}/`, `faces/{tenant}/{camera}/`, `watchlist/{tenant}/`

### DNS (flactech.com.br)

| Subdomínio | IP | Função |
|-----------|-----|--------|
| guard.flactech.com.br | 147.93.141.133 | Dashboard cliente |
| api-guard.flactech.com.br | 147.93.141.133 | API REST |
| rtmp-guard.flactech.com.br | 147.93.141.133 | RTMP ingest (câmeras) |
| hls-guard.flactech.com.br | 147.93.141.133 | HLS playback |
| ssh-guard.flactech.com.br | 147.93.141.133 | SSH |
| deploy-guard.flactech.com.br | 147.93.141.133 | Deploy webhook |

### Volumes Docker

| Volume | Conteúdo |
|--------|----------|
| `flac-guard_pgdata` | PostgreSQL (banco + pgvector) |
| `flac-guard_hls_data` | Segmentos HLS (live, temporários) |
| `flac-guard_recordings` | Buffer local de gravações (antes de upload S3) |

---

## 3. Multi-tenant

### Implementação (Migration 008)

Tabela `tenants` com isolamento lógico. Cada tabela principal tem `tenant_id`. Todas as queries filtram por tenant via `services/tenant.js`.

```
tenants: { id, name, slug, plan, max_cameras, max_storage_gb, is_active, settings }
```

Tabelas com tenant_id direto: `pdvs`, `cameras`, `users`, `api_keys`, `webhooks`, `face_watchlist`.

Tabelas sem tenant_id (isoladas via JOIN com cameras/users): `recordings`, `events`, `face_embeddings`, `face_alerts`, `daily_visitors`, `face_search_log`, `system_alerts`.

Tenant default: **Happydo Mercadinhos** (slug: `happydo`, plan: `enterprise`).

### Auth com tenant

JWT inclui `tenant_id`. API Keys incluem `tenant_id`. Middleware `authenticate()` extrai o tenant do token/key. Helper `getTenantId(req)` disponível em todas as routes.

### Stream keys

Prefixo com slug do tenant: `happydo_<random>`. Callback `on_publish` valida stream key e identifica o tenant.

---

## 4. Object Storage (S3)

### Fluxo de gravação

```
FFmpeg grava MP4 local (/data/recordings/)
  → INSERT no banco (file_path)
  → Se S3 configurado:
    → Upload para Contabo S3 (key: recordings/{tenant}/{camera}/{date}/{file})
    → UPDATE recordings SET s3_key = ...
    → DELETE arquivo local
  → Se S3 não configurado:
    → Mantém no disco local (fallback)
```

### Playback

```
GET /api/recordings/:id/stream
  → Se recording.s3_key existe:
    → Gera pre-signed URL (1h) → redirect 302
  → Se s3_key NULL:
    → Serve do disco local (Range headers)
```

### Cleanup

Respeita `retention_days` por câmera. Deleta do S3 (se s3_key) e do disco local (se file_path existe). Roda a cada hora.

### Migração batch

Service `s3-migration.js` com controle de estado: start, pause, resume, cancel. Upload concorrente (5 simultâneos). Endpoint no dashboard para acompanhar progresso.

---

## 5. Nginx-RTMP

- **Porta 1935:** RTMP ingest
- **Porta 8080:** HLS + RTMP stats (XML)
- **HLS:** fragmentos 3s, playlist 60s, cleanup automático
- **Gravação:** gerenciada pelo Node.js (não pelo Nginx)
- **Auth:** callback `on_publish` → `http://api:8000/hooks/on-publish` (valida stream key)
- **Callback on_publish_done:** marca câmera offline, para gravação

---

## 6. API Backend (Node.js)

### Serviços Background

| Serviço | Intervalo | Função |
|---------|-----------|--------|
| Motion Detector | 3-4s/câmera | Extrai frame HLS, compara pixels, detecta pessoas/rostos |
| Continuous Recorder | 30s | Gerencia gravação contínua |
| Visitor Counter | 10 min | Visitantes distintos/câmera/dia |
| Cleanup | 1 hora | Deleta gravações expiradas + S3 |
| Disk Monitor | 15 min | Alerta 85%/90% disco, quota por câmera |
| Camera Health | 60s | Marca offline se sem heartbeat 90s |
| Face Service Check | 30s | Verifica disponibilidade InsightFace |

### Pipeline Unificado (Motion Detector)

Para cada câmera online, a cada 3-4 segundos:

1. Extrai frame HLS (FFmpeg 320×240)
2. Compara pixels → detecção de movimento
3. Se face service disponível:
   - YOLO detecta pessoas (corpo inteiro)
   - InsightFace detecta rostos (two-pass: direto + person-guided)
   - Embeddings 512D → pgvector
   - Compara com watchlist → match >85% → alerta
4. Movimento detectado → inicia gravação FFmpeg (MP4, pre-buffer 24s)
5. Sem movimento 30s → para gravação → upload S3

### Modos de gravação (por câmera)

| Modo | Comportamento |
|------|--------------|
| `continuous` | Grava sempre (segmentos 15min) |
| `motion` | Grava só com movimento |

### Tipos de câmera (Migration 007)

| Campo | Valores | Função |
|-------|---------|--------|
| `camera_purpose` | `environment` / `face` | Define se é câmera de ambiente ou facial |
| `capture_face` | `true` / `false` | Ativa/desativa detecção facial nessa câmera |

Câmeras `face` são priorizadas para contagem de visitantes.

---

## 7. Face Service (Python)

Serviço separado: InsightFace + YOLO26n via FastAPI/Uvicorn.

### Endpoints

| Método | Endpoint | Função |
|--------|----------|--------|
| POST | `/detect` | Rostos (two-pass: direto + person-guided) |
| POST | `/embed` | Embedding 512D de foto (para busca) |
| POST | `/detect-persons` | Pessoas via YOLO26n |
| GET | `/health` | Status dos modelos |

### Two-pass detection

1. Detecção direta no frame (threshold 0.3)
2. Se nenhum rosto → YOLO detecta pessoas → crop upper body 50% → retry (threshold 0.2)

Resolve ângulo ruim de câmeras no teto.

### Modelos

| Modelo | Função | Tamanho |
|--------|--------|---------|
| InsightFace buffalo_l | Detecção + embedding 512D | ~300MB |
| YOLO26n | Detecção de pessoas | ~12MB |

---

## 8. Banco de Dados

PostgreSQL 16 + extensões `uuid-ossp` + `vector` (pgvector).

### Migrations aplicadas

| # | Arquivo | Função |
|---|---------|--------|
| 001 | pdvs_pulse_fields.sql | Campos Pulse + constraint modelos câmera |
| 002 | settings_table.sql | Tabela settings (key-value) |
| 003 | camera_recording_settings.sql | recording_mode, retention_days, motion_sensitivity |
| 004 | face_recognition.sql | face_embeddings (HNSW), watchlist, alerts, visitors, audit |
| 005 | face_person_linking.sql | person_id em face_embeddings |
| 006 | alerts_and_storage_quota.sql | system_alerts + storage_quota_gb |
| 007 | camera_purpose.sql | camera_purpose (environment/face) + capture_face |
| 008 | multi_tenant.sql | Tabela tenants + tenant_id em todas tabelas |
| 009 | s3_storage.sql | s3_key em recordings, face_embeddings, watchlist |

### Tabelas principais

| Tabela | Propósito | Tenant? |
|--------|-----------|:-------:|
| tenants | Clientes SaaS | — |
| pdvs | Pontos de venda (sync Pulse) | ✅ |
| cameras | Câmeras com stream key, modo, retenção, purpose | ✅ |
| recordings | Gravações MP4 (local ou S3) | via camera |
| events | motion, online, offline, error, ai_alert | via camera |
| users | Usuários dashboard (admin, operator, viewer) | ✅ |
| api_keys | Chaves server-to-server | ✅ |
| webhooks | Destinos configuráveis | ✅ |
| settings | Config key-value (Pulse, RTMP host) | global |
| face_embeddings | Embeddings 512D + HNSW index | via camera |
| face_watchlist | Pessoas de interesse (permanente) | ✅ |
| face_alerts | Matches watchlist | via camera |
| daily_visitors | Visitantes distintos/câmera/dia | via camera |
| face_search_log | Audit log LGPD | via user |
| system_alerts | Disco, quota, etc. | via camera |

---

## 9. Dashboard (React)

React 18 + TypeScript + Vite. Proxy: `/api/` → api:8000, `/hls/` → nginx-rtmp:8080.

### Páginas

| Rota | Componente | Função |
|------|-----------|--------|
| `/` | Live.tsx (237 linhas) | Mosaico HLS, filtro online/offline, grid ajustável |
| `/cameras` | Cameras.tsx (1041) | CRUD câmeras, config RTMP, modo, retenção, purpose, quota |
| `/playback` | Playback.tsx (921) | Timeline, player, detecção facial em frames |
| `/faces` | FaceSearch.tsx (401) | Busca facial, watchlist CRUD, status serviço |
| `/visitors` | Visitors.tsx (358) | Contagem visitantes/PDV/dia, gráfico temporal |
| `/pdvs` | PDVs.tsx (101) | Lista PDVs com câmeras online/offline |
| `/monitor` | Monitoring.tsx (381) | CPU, RAM, disco, rede, Docker, S3, banco |
| `/settings` | Settings.tsx (561) | Pulse, deploy status, config RTMP, S3 migration |
| `/stats` | Stats.tsx (267) | RTMP real-time (bandwidth, streams, codecs) |

### Auth

JWT (1h) + setup inicial (primeiro admin) + roles (admin, operator, viewer). Tenant isolado no token.

---

## 10. API — Endpoints

### Auth
```
POST   /api/auth/login
POST   /api/auth/setup            # Primeiro admin
POST   /api/auth/register         # Admin only
```

### Cameras
```
GET    /api/cameras                # Filtros: pdv_id, status, model
POST   /api/cameras                # Cadastrar (gera stream key com prefixo tenant)
PUT    /api/cameras/:id            # Nome, modelo, modo, retenção, purpose, quota
DELETE /api/cameras/:id
GET    /api/cameras/:id/live       # URL HLS
GET    /api/cameras/:id/recordings # Por período
GET    /api/cameras/:id/recording  # Por timestamp exato
GET    /api/cameras/:id/snapshot   # Frame JPEG (501 — pendente)
GET    /api/cameras/:id/download   # Trecho MP4 (501 — pendente)
GET    /api/cameras/models         # Modelos suportados
```

### Recordings
```
GET    /api/recordings             # Filtros: camera_id, from, to
GET    /api/recordings/by-day      # Timeline por dia
GET    /api/recordings/:id/stream  # Stream MP4 (S3 pre-signed URL ou local)
GET    /api/recordings/:id/download
DELETE /api/recordings/:id
POST   /api/recordings/cleanup     # Forçar limpeza
POST   /api/recordings/:id/detect-faces
POST   /api/recordings/:id/search-face
GET    /api/recordings/s3-status          # Status do S3
POST   /api/recordings/s3-migrate         # Iniciar migração batch
GET    /api/recordings/s3-migrate/status   # Progresso migração
POST   /api/recordings/s3-migrate/pause
POST   /api/recordings/s3-migrate/resume
POST   /api/recordings/s3-migrate/cancel
```

### Face Recognition
```
POST   /api/faces/search           # Upload foto → aparições (admin only)
GET    /api/faces/status
GET    /api/faces/watchlist
POST   /api/faces/watchlist
PUT    /api/faces/watchlist/:id
DELETE /api/faces/watchlist/:id
GET    /api/faces/watchlist/:id/photo
GET    /api/faces/alerts
PUT    /api/faces/alerts/:id/acknowledge
GET    /api/faces/visitors          # Por período/PDV
```

### PDVs + Monitoramento + Outros
```
GET    /api/pdvs                    # Com contagem câmeras
POST   /api/pdvs/sync              # Sync do HappyDoPulse
GET    /api/events                  # Filtros: camera_id, pdv_id, type
POST   /api/webhooks                # Admin only
GET    /api/monitor/system          # CPU, RAM, disco, rede, containers
GET    /api/monitor/disk-breakdown
GET    /api/alerts                  # System alerts
PUT    /api/alerts/:id/resolve
GET    /api/settings/pulse
PUT    /api/settings/pulse
POST   /api/settings/pulse/test
GET    /api/deploy-status
GET    /health
```

### Auth: JWT + API Key + query param token. Rate limit: 200 req/min.

---

## 11. CI/CD

### Deploy automático

```
Push GitHub (main) → webhook :9000 → deploy.sh:
  git pull → docker compose build (por serviço, com build args)
  → docker compose up -d → health check todos serviços
  → deploy-status.json (commit, status, tempos, containers)
```

Self-update: deploy.sh detecta se ele próprio mudou e faz re-exec.

### Subdomínios

Deploy webhook: deploy-guard.flactech.com.br:9000

---

## 12. Integrações

### HappyDoPulse

Sync de PDVs via API REST JWT. Credenciais configuráveis via dashboard ou env. Paginação automática.

### Contabo S3

Upload de gravações + face images + watchlist photos. Pre-signed URLs para playback. Migração batch com controle de estado.

---

## 13. Inventário de Câmeras

### Modelos suportados (constraint banco)

| Modelo | RTMP | Grupo | Purpose |
|--------|:----:|:-----:|---------|
| iM3 C | ✅ | im | environment / face |
| iM5 SC | ✅ | im | environment / face |
| iMX | ✅ | im | environment / face |
| IC3 | ❌ | ic | environment |
| IC5 | ❌ | ic | environment |

### Nota sobre RTMP no Brasil

RTMP push nativo em câmeras Wi-Fi é praticamente exclusivo da Intelbras (linha MIBO + VIP). Nenhuma outra marca de consumo (TP-Link, Xiaomi, Hikvision consumer) oferece RTMP push em câmeras Wi-Fi baratas no Brasil.

---

## 14. Segurança

- Stream keys únicas com prefixo de tenant, validadas via callback Nginx → API
- JWT com roles + tenant_id. API Key com tenant_id
- Rate limiting: 200 req/min
- Busca facial: admin only + audit log (LGPD)
- Embeddings não reversíveis. Watchlist permanente, remoção manual
- Retenção configurável por câmera (padrão 21, máximo 60 dias)
- Webhook deploy autenticado com HMAC-SHA256
- S3: pre-signed URLs com expiração (1h)

---

## 15. Estrutura do Repositório

```
FlacGuard/
├── .env.example
├── docker-compose.yml
├── ARCHITECTURE.md
├── README.md
├── deploy/
│   ├── webhook.js                  # HTTP :9000, GitHub webhook
│   ├── deploy.sh                   # Build + restart + health check
│   ├── setup.sh                    # Systemd + secret
│   └── flac-guard-webhook.service
├── server/
│   ├── nginx-rtmp/
│   │   ├── nginx.conf              # RTMP + HLS + callbacks
│   │   └── Dockerfile
│   ├── api/
│   │   ├── Dockerfile              # Node 20 + FFmpeg
│   │   ├── package.json            # Express, pg, aws-sdk, bcrypt, jwt
│   │   └── src/
│   │       ├── index.js            # Bootstrap + 7 background services
│   │       ├── db/
│   │       │   ├── schema.sql
│   │       │   ├── pool.js         # PG pool + timezone SP
│   │       │   └── migrations/     # 001-009
│   │       ├── routes/
│   │       │   ├── auth.js         # Login, setup, register
│   │       │   ├── cameras.js      # CRUD + live + recordings + snapshot
│   │       │   ├── recordings.js   # Playback (S3/local) + cleanup + face + S3 migration
│   │       │   ├── events.js
│   │       │   ├── pdvs.js         # Lista + sync Pulse
│   │       │   ├── faces.js        # Search + watchlist + visitors + alerts
│   │       │   ├── hooks.js        # Nginx RTMP callbacks
│   │       │   ├── webhooks.js
│   │       │   ├── settings.js     # Pulse config + RTMP host
│   │       │   ├── monitor.js      # System stats + S3 status
│   │       │   └── alerts.js       # System alerts
│   │       └── services/
│   │           ├── tenant.js           # getTenantId, tenantFilter, getTenantSlug
│   │           ├── storage.js          # S3 upload/download/delete/presign
│   │           ├── s3-migration.js     # Batch migration local→S3
│   │           ├── motion-detector.js  # Pipeline unificado
│   │           ├── recorder.js         # FFmpeg + S3 upload
│   │           ├── recording.js        # Queries de busca
│   │           ├── face-recognition.js # Client face-service
│   │           ├── cleanup.js          # Retenção + S3 delete
│   │           ├── disk-monitor.js     # Alertas disco/quota
│   │           ├── health.js           # Camera offline detection
│   │           ├── rtmp.js             # URLs RTMP/HLS
│   │           ├── pulse.js            # Client HappyDoPulse
│   │           └── auth.js             # JWT + bcrypt + API Key + tenant
│   ├── face-service/
│   │   ├── Dockerfile              # Python 3.11 + InsightFace + YOLO
│   │   ├── app.py                  # FastAPI: detect, embed, detect-persons
│   │   └── requirements.txt
│   └── recorder/
│       └── record.sh               # FFmpeg segment recording (alternativo)
├── dashboard/
│   ├── Dockerfile                  # Node build → Nginx serve
│   ├── nginx.conf                  # Proxy /api/ e /hls/
│   └── src/
│       ├── App.tsx                 # Router (9 páginas) + nav
│       ├── context/AuthContext.tsx  # JWT + tenant
│       ├── components/HlsPlayer.tsx
│       └── pages/                  # Live, Cameras, Playback, FaceSearch,
│                                   # Visitors, PDVs, Monitoring, Settings, Stats, Login
├── agent/                          # Pi Zero (RTSP→RTMP bridge)
│   ├── install.sh
│   ├── rtsp-to-rtmp.sh
│   └── systemd/flac-guard-agent.service
└── docs/
    ├── API_EXTERNAL_ACCESS.md      # Integração HappyDoPulse
    ├── SETUP_S3_CONTABO.md         # Guia S3
    ├── MIGRACAO_NOVO_SERVIDOR.md   # Guia migração VPS
    ├── Plano_Escala_Fase_2_5.md    # Plano de escala
    ├── cameras.md                  # Inventário
    ├── rtmp-setup.md               # Config câmeras MIBO
    └── vps-setup.md                # Setup VPS
```

---

## 16. Roadmap SaaS

### Concluído ✅

- [x] Fase 1: PoC (3 câmeras RTMP, dashboard)
- [x] Fase 2: Produto (motion detector, face recognition, gravação, dashboard completo)
- [x] Fase 2.5A: Multi-tenant + S3 (tenant_id, storage.js, s3-migration, cleanup S3)
- [x] VPS upgrade (VPS 20 NVMe)
- [x] DNS + subdomínios configurados
- [x] Email: Google Workspace (@flactech.com.br) + Brevo (transacional)

### Próximo: Fase 2.5B — VPS de Controle

Novo repositório `flac-guard-control` com:
- Licensing API (tenants, planos, nós)
- Stripe billing (subscriptions por câmera)
- Landing page (flactech.com.br) + pricing table
- Admin dashboard (app.flactech.com.br)
- Email transacional (Brevo SMTP + nodemailer)
- Node health monitoring
- Provisionamento automático de nós (Contabo API)

### Planos SaaS definidos

| Plano | Preço/câmera | PDVs | Câm/PDV | Retenção |
|-------|:-----------:|:----:|:-------:|:--------:|
| Tester | Grátis (30 dias) | 1 | 2 | 14 dias |
| Monitoring | R$ 49,90 | 30 | 3 | 21 dias |
| Advanced | R$ 59,90 | 100 | 3 | 21 dias |
| Ultra | R$ 44,90 | 300 | 3 | 21 dias |

Cobrança por câmera ativa + 1 facial grátis por PDV.

### Pendências (não bloqueiam SaaS)

- Endpoints snapshot e download (retornam 501)
- UI gestão de tenants (CRUD no dashboard)
- CRUD de API Keys
- Migração S3 → Backblaze B2 + Cloudflare CDN
- Guard Cam (app Android Kotlin para captura facial frontal)
