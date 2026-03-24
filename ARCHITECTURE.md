# Flac Guard — Arquitetura do Sistema

> Versão 6.0 | Março 2026
> Repositório nó: `github.com/andrelealpb/FlacGuard`
> Repositório controle: `github.com/andrelealpb/flac-guard-control`
> Domínio: flactech.com.br (registro Registro.br, DNS Cloudflare)
> Status: Produção (5 câmeras, multi-tenant, S3 ativo) + SaaS em implementação

---

## 1. Visão Geral

O Flac Guard é um SaaS de vídeo monitoramento com reconhecimento facial para mercadinhos autônomos. A arquitetura é composta por dois sistemas:

**Control** (VPS 10) — ponto único de acesso. Serve dashboard React, faz gateway JSON para os nós, gerencia billing/licensing/provisioning. Nunca trafega vídeo.

**Nós de processamento** (N × VPS 30) — recebem streams RTMP, gravam, processam facial, servem HLS ao vivo. Cada nó suporta ~40 câmeras. Um tenant pode ter múltiplos nós.

**Princípio fundamental:** Control só trafega JSON. Vídeo ao vivo (HLS) vai direto do browser para o nó. Playback vai direto do browser para o S3. O cliente não sabe quantos nós existem.

### Números atuais (produção)

| Métrica | Valor |
|---------|-------|
| Câmeras online | 5/5 |
| PDVs monitorados | 3 |
| Face embeddings | 51.364+ |
| S3 usado | 22.3 GB |
| Consumo médio/câmera | 0.53 GB/dia |
| CPU por câmera (medido) | ~0.16-0.18 vCPU |

### Stack

| Componente | Tecnologia | Repo |
|-----------|-----------|:----:|
| Control API + Gateway | Node.js 20 + Express (ESM) | control |
| Dashboard cliente | React 18 + TypeScript + Vite | control |
| Dashboard admin | React 18 + TypeScript + Vite | control |
| Landing page | HTML/CSS/JS | control |
| Billing | Stripe SDK | control |
| DNS automático | Cloudflare API | control |
| Provisioning VPS | Contabo API | control |
| Email transacional | Brevo SMTP + nodemailer | control |
| Servidor RTMP | Nginx-RTMP (Docker) | nó |
| API Backend (nó) | Node.js 20 + Express (ESM) | nó |
| Face Service | Python 3.11 + InsightFace + YOLO26n (FastAPI) | nó |
| Banco (nó) | PostgreSQL 16 + pgvector | nó |
| Banco (control) | PostgreSQL 16 | control |
| Object Storage | Contabo S3 (AWS SDK) | compartilhado |
| CI/CD | GitHub webhook → deploy.sh | nó |

---

## 2. Arquitetura

```
┌──────────────────────────────────────────────────┐
│        VPS DE CONTROLE (VPS 10, $3.96)            │
│        Só JSON, nunca vídeo                       │
│                                                    │
│  flactech.com.br         → Landing page            │
│  guard.flactech.com.br   → Dashboard cliente (SPA) │
│  app.flactech.com.br     → Dashboard admin         │
│  api.flactech.com.br     → API gateway             │
│                                                    │
│  Gateway (consulta nós em paralelo, merge JSON)    │
│  Retorna URLs diretas: nó (HLS) e S3 (playback)   │
│  Stripe billing + Contabo API + Cloudflare API     │
│  PostgreSQL (tenants, plans, nodes, tenant_nodes)  │
└──────────────────────────────────────────────────┘
          │ JSON only
          ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  NÓ #1     │ │  NÓ #2     │ │  NÓ #N     │
│  VPS 30    │ │  VPS 30    │ │  VPS 30    │
│  $12/mês   │ │  $12/mês   │ │  $12/mês   │
│            │ │            │ │            │
│ node-1.flactech.com.br (HTTPS)           │
│            │ │            │ │            │
│ Nginx-RTMP │ │ Nginx-RTMP │ │ Nginx-RTMP │
│ API Node.js│ │ API Node.js│ │ API Node.js│
│ Face Svc   │ │ Face Svc   │ │ Face Svc   │
│ PostgreSQL │ │ PostgreSQL │ │ PostgreSQL │
│            │ │            │ │            │
│ Browser ←HLS direto→     │ │            │
│ ~40 câmeras│ │ ~40 câmeras│ │ ~40 câmeras│
└────────────┘ └────────────┘ └────────────┘
          │              │              │
          ▼              ▼              ▼
┌──────────────────────────────────────────────────┐
│    CONTABO S3 (US-Central, auto-scaling)          │
│    Browser ←pre-signed URL direto→ S3             │
│    recordings/{tenant}/{camera}/{date}/            │
│    faces/{tenant}/{camera}/{date}/                 │
│    watchlist/{tenant}/                             │
└──────────────────────────────────────────────────┘
```

### Fluxo de vídeo (nunca passa pelo Control)

```
Live:
  Browser → GET guard.flactech.com.br/api/cameras/X/live
  → Control: "câmera X está no nó 2"
  → Retorna { hls_url: "https://node-2.flactech.com.br/hls/key.m3u8" }
  → HLS.js conecta DIRETO no nó 2

Playback:
  Browser → GET guard.flactech.com.br/api/recordings/Y/stream
  → Control pede ao nó: gera pre-signed URL
  → Retorna { url: "https://usc1.contabostorage.com/...?sig=..." }
  → Browser conecta DIRETO no S3

Busca facial:
  Browser → POST guard.flactech.com.br/api/faces/search
  → Control distribui para TODOS os nós em paralelo
  → Cada nó busca no seu pgvector local
  → Control merge por similarity score → retorna JSON unificado
```

---

## 3. Infraestrutura

### Control (VPS 10)

| Recurso | Detalhe |
|---------|---------|
| Plano | Cloud VPS 10 NVMe ($3.96/mês) |
| Specs | 4 vCPU, 8 GB RAM, 75 GB NVMe |
| Região | US-Central |
| Carga | ~0.5-1.0 vCPU (só JSON, não vídeo) |

### Nó de processamento (VPS 30 — célula padrão)

| Recurso | Detalhe |
|---------|---------|
| Plano | Cloud VPS 30 NVMe ($12/mês) |
| Specs | 8 vCPU, 24 GB RAM, 200 GB NVMe |
| Capacidade | ~40 câmeras (mix 60% ambiente + 40% facial) |
| Containers | nginx-rtmp, api, face-service, db (4 containers) |
| HTTPS | Certbot (node-N.flactech.com.br) |

### Object Storage (Contabo S3)

| Recurso | Detalhe |
|---------|---------|
| Bucket | FlacGuard-S3 (US-Central, mesma região dos VPS) |
| Base | 250 GB ($2.99/slot) |
| Auto-scaling | Habilitado com cap por tenant |
| Consumo/câmera | ~0.53 GB/dia (medido) |
| Prefixos | `recordings/{tenant}/{camera}/`, `faces/`, `watchlist/` |

### DNS (Cloudflare)

Domínio registrado no Registro.br. Nameservers apontados para Cloudflare.
Control cria/deleta registros A via Cloudflare API automaticamente.

```
flactech.com.br          → Control (landing)
www.flactech.com.br      → Control (landing)
guard.flactech.com.br    → Control (dashboard cliente)
app.flactech.com.br      → Control (admin)
api.flactech.com.br      → Control (gateway)
node-1.flactech.com.br   → Nó 1 (HLS + RTMP + API interna)
node-N.flactech.com.br   → Nó N (criado automaticamente via API)
```

### Email

| Serviço | Função |
|---------|--------|
| Google Workspace | Corporativo: leal@, suporte@, contato@flactech.com.br |
| Brevo SMTP | Transacional: noreply@flactech.com.br |

---

## 4. Multi-tenant

### Implementação (nó — Migration 008)

Tabela `tenants` com isolamento lógico. Cada tabela principal tem `tenant_id`.
Todas as queries filtradas via `services/tenant.js`.

Tabelas com tenant_id direto: `pdvs`, `cameras`, `users`, `api_keys`, `webhooks`, `face_watchlist`.
Tabelas sem tenant_id (via JOIN): `recordings`, `events`, `face_embeddings`, `face_alerts`, `daily_visitors`.

### Multi-nó por tenant (Control)

Tabela `tenant_nodes` (N:N). Um tenant pode ter 1 ou mais nós.
Tabela `camera_node_map` registra qual câmera está em qual nó.
O Control consulta todos os nós do tenant em paralelo e consolida.

O cliente não sabe quantos nós existem — experiência transparente.

### Stream keys

Prefixo com slug do tenant: `happydo_<random>`. Cada câmera aponta RTMP para o IP do nó onde foi alocada: `rtmp://node-N.flactech.com.br:1935/live/happydo_xyz`.

---

## 5. Object Storage (S3)

### Fluxo de gravação

```
FFmpeg grava MP4 local (/data/recordings/)
  → INSERT no banco (file_path)
  → Upload para Contabo S3 (key: recordings/{tenant}/{camera}/{date}/{file})
  → UPDATE recordings SET s3_key = ...
  → DELETE arquivo local
```

### Playback

```
GET /api/recordings/:id/stream (no nó, via Control gateway)
  → Nó gera pre-signed URL (1h) do S3
  → Control retorna URL ao browser
  → Browser conecta direto no S3
```

### Cleanup

Respeita `retention_days` por câmera. Deleta do S3 e do disco local. Roda a cada hora.

---

## 6. Nó — Detalhamento

### Containers Docker (4, sem dashboard)

```yaml
services:
  nginx-rtmp      # Porta 1935 (RTMP) + 8080 (HLS)
  api             # Porta 8000 (API interna + endpoints internos)
  face-service    # Porta 8001 (InsightFace + YOLO, limite 2GB RAM)
  db              # PostgreSQL 16 + pgvector
  # Dashboard REMOVIDO — cliente acessa via Control
```

### Nginx no host (HTTPS)

```
node-N.flactech.com.br:443
  /hls/   → proxy localhost:8080 (HLS, browser acessa direto, CORS para guard.flactech.com.br)
  /api/internal/ → proxy localhost:8000 (só Control acessa)
  /       → 404 (bloqueado)
```

### Serviços Background

| Serviço | Intervalo | Função |
|---------|-----------|--------|
| Motion Detector | 3-4s/câmera | Frame HLS → pixel diff → YOLO → InsightFace → pgvector |
| Continuous Recorder | 30s | Gravação contínua (segmentos 15min) |
| Visitor Counter | 10 min | Visitantes distintos/câmera/dia |
| Cleanup | 1 hora | Deleta gravações expiradas do S3 e disco |
| Disk Monitor | 15 min | Alertas 85%/90% disco |
| Camera Health | 60s | Marca offline se sem heartbeat 90s |
| Usage Reporter | 5 min | Reporta uso ao Control |

### Pipeline Unificado (Motion Detector)

Para cada câmera online, a cada 3-4 segundos:

1. Extrai frame HLS (FFmpeg 320×240)
2. Compara pixels → detecção de movimento
3. YOLO detecta pessoas (corpo inteiro)
4. InsightFace detecta rostos (two-pass: direto + person-guided)
5. Embeddings 512D → pgvector
6. Compara com watchlist → match >85% → alerta
7. Movimento → inicia gravação FFmpeg (MP4, pre-buffer 24s)
8. Sem movimento 30s → para gravação → upload S3

### Endpoints internos (routes/internal.js)

Auth: `X-Internal-Key` + `X-Tenant-Id`. Chamados exclusivamente pelo Control.

```
POST   /api/internal/tenants           # Criar tenant no nó
DELETE /api/internal/tenants/:id        # Desativar
PUT    /api/internal/tenants/:id/limits # Atualizar plano

GET    /api/internal/cameras            # Listar
POST   /api/internal/cameras            # Criar
PUT    /api/internal/cameras/:id        # Atualizar
DELETE /api/internal/cameras/:id
GET    /api/internal/cameras/:id/live   # URL HLS local

GET    /api/internal/recordings         # Listar
GET    /api/internal/recordings/by-day
GET    /api/internal/recordings/:id/stream  # Pre-signed URL S3

POST   /api/internal/faces/search       # Busca pgvector local
GET    /api/internal/faces/watchlist
POST   /api/internal/faces/watchlist
GET    /api/internal/faces/visitors
GET    /api/internal/faces/alerts

GET    /api/internal/pdvs
POST   /api/internal/pdvs/sync
GET    /api/internal/events
GET    /api/internal/monitor/system
POST   /api/internal/usage              # Reportar ao Control
```

---

## 7. Face Service (Python)

InsightFace (buffalo_l) + YOLO26n via FastAPI/Uvicorn.

| Endpoint | Função |
|----------|--------|
| POST /detect | Rostos (two-pass: direto + person-guided via YOLO) |
| POST /embed | Embedding 512D de foto |
| POST /detect-persons | Pessoas via YOLO26n |
| GET /health | Status modelos |

### Two-pass detection

1. Detecção direta no frame (threshold 0.3)
2. Se nenhum rosto → YOLO localiza pessoas → crop upper body 50% → retry (threshold 0.2)

Resolve câmeras no teto com ângulo ruim.

---

## 8. Banco de Dados

### Nó: PostgreSQL 16 + pgvector

Migrations 001-009. Tabelas: tenants, pdvs, cameras, recordings, events, users, api_keys, webhooks, settings, face_embeddings (HNSW 512D), face_watchlist, face_alerts, daily_visitors, system_alerts.

### Control: PostgreSQL 16

Tabelas: plans, nodes, tenants, tenant_nodes, camera_node_map, admin_users, billing_events, node_health_log.

---

## 9. Dashboard do Cliente

React 18 + TypeScript + Vite. Servido pelo Control (guard.flactech.com.br).
Cópia adaptada do dashboard do nó, com URLs absolutas para HLS (nó) e S3 (playback).

### Páginas

| Rota | Função |
|------|--------|
| `/` | Live — mosaico HLS (URLs apontam direto para nós) |
| `/cameras` | CRUD câmeras (via gateway, Control seleciona nó) |
| `/playback` | Timeline + player (URLs apontam direto para S3) |
| `/faces` | Busca facial (distribuída em todos os nós) + watchlist |
| `/visitors` | Contagem visitantes (consolidada de todos os nós) |
| `/pdvs` | PDVs com status (consolidado) |
| `/monitor` | Stats de todos os nós (consolidado) |
| `/settings` | Config do tenant |

---

## 10. Provisionamento Automático

### Novo nó (quando tenant precisa de mais capacidade)

```
1. Control detecta nó ≥85% capacidade
2. Contabo API → POST /v1/compute/instances (VPS 30, cloud-init)
3. Cloudflare API → POST DNS A record (node-N.flactech.com.br → IP)
4. Cloud-init: Docker + git clone FlacGuard + docker compose up
5. Certbot: SSL para node-N.flactech.com.br
6. Control: INSERT nodes + tenant_nodes
7. Health check → status 'active'
8. Tempo total: ~3-5 minutos
```

---

## 11. Segurança

- Stream keys únicas com prefixo de tenant, validadas via callback Nginx → API
- JWT com tenant_id (Control e nó). API Key com tenant_id
- Endpoints internos do nó: auth `X-Internal-Key` (só Control acessa)
- HLS via HTTPS (Certbot, CORS restrito a guard.flactech.com.br)
- S3: pre-signed URLs com expiração (1h)
- Busca facial: admin only + audit log (LGPD)
- Rate limiting: 200 req/min
- Webhook deploy: HMAC-SHA256
- Stripe: webhooks com signature verification

---

## 12. Estrutura dos Repositórios

### FlacGuard (nó de processamento)

```
FlacGuard/
├── docker-compose.yml          # 4 containers (sem dashboard)
├── server/
│   ├── nginx-rtmp/             # RTMP + HLS
│   ├── api/src/
│   │   ├── routes/
│   │   │   ├── internal.js     # Endpoints para o Control
│   │   │   ├── cameras.js, recordings.js, faces.js, ...
│   │   │   └── hooks.js        # Callback Nginx RTMP
│   │   └── services/
│   │       ├── tenant.js       # Isolamento multi-tenant
│   │       ├── storage.js      # S3 upload/download/presign
│   │       ├── motion-detector.js
│   │       ├── recorder.js
│   │       ├── face-recognition.js
│   │       ├── cleanup.js
│   │       └── ...
│   ├── face-service/           # Python + InsightFace + YOLO
│   └── recorder/
├── agent/                      # Pi Zero (RTSP→RTMP bridge)
└── docs/
```

### flac-guard-control

```
flac-guard-control/
├── docker-compose.yml          # 5 containers (api, client-dash, admin-dash, landing, db)
├── server/src/
│   ├── routes/
│   │   ├── gateway-*.js        # Proxy JSON → nós, merge, URLs diretas
│   │   ├── billing.js          # Stripe
│   │   ├── admin-*.js          # Painel admin
│   │   └── internal.js         # Nós → Control (usage, health)
│   └── services/
│       ├── gateway.js          # queryAllNodes, merge, findCameraNode
│       ├── cloudflare.js       # DNS API (criar node-N.flactech.com.br)
│       ├── contabo.js          # VPS API (provisionar)
│       ├── provisioning.js     # Orquestrar VPS + DNS + SSL
│       ├── stripe.js
│       ├── email.js            # Brevo SMTP
│       └── node-health.js
├── client-dashboard/           # Dashboard do CLIENTE (React)
├── admin-dashboard/            # Dashboard do ADMIN (React)
└── landing/                    # Site comercial
```

---

## 13. Planos SaaS

| Plano | Preço/câmera | PDVs | Câm/PDV | Retenção |
|-------|:-----------:|:----:|:-------:|:--------:|
| Tester | Grátis (30 dias) | 1 | 2 | 14 dias |
| Monitoring | R$ 49,90 | 30 | 3 | 21 dias |
| Advanced | R$ 59,90 | 100 | 3 | 21 dias |
| Ultra | R$ 44,90 | 300 | 3 | 21 dias |

Cobrança por câmera ativa + 1 facial grátis/PDV. Stripe per-unit.

---

## 14. Roadmap

### Concluído ✅

- [x] Fase 1: PoC (3 câmeras RTMP)
- [x] Fase 2: Produto completo (motion, facial, gravação, dashboard)
- [x] Fase 2.5A: Multi-tenant + S3 no nó
- [x] VPS upgrade + S3 + DNS + subdomínios
- [x] Email: Google Workspace + Brevo

### Em implementação: Fase 2.5B — SaaS

- [ ] Endpoints internos no nó (routes/internal.js)
- [ ] VPS Control + Cloudflare DNS
- [ ] Control: API gateway multi-nó
- [ ] Control: Dashboard cliente unificado
- [ ] Control: Stripe billing
- [ ] Control: Provisioning automático (Contabo API + Cloudflare API)
- [ ] HappyDo go-live: 4 nós VPS 30, 154 câmeras

### Pendências (não bloqueiam SaaS)

- Endpoints snapshot e download (retornam 501)
- Miniaturas na timeline
- Push notifications / alertas de watchlist
- App mobile (Guard Cam, Kotlin)
- Migração S3 → Backblaze B2 + Cloudflare CDN
