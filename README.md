# Flac Guard — Nó de Processamento

Sistema SaaS de vídeo monitoramento com reconhecimento facial para mercadinhos autônomos.

Este repositório é o **nó de processamento** — recebe RTMP, grava, processa facial, armazena no S3. O dashboard do cliente e billing ficam no [Control](https://github.com/andrelealpb/flac-guard-control).

Desenvolvido pela [Flac Tech](https://flactech.com.br) — João Pessoa/PB.

## O que faz

- **Recebe streams RTMP** de câmeras Intelbras MIBO (push outbound)
- **Grava por movimento** — pipeline YOLO + InsightFace a cada 3-4s por câmera
- **Reconhecimento facial** — embeddings 512D via InsightFace + pgvector
- **Watchlist** — match >85% gera alerta automático
- **Persons** — perfis nomeados de embeddings agrupados (mesma pessoa, diferentes aparências)
- **Busca por pessoa** — encontre todas as aparições de uma pessoa em todas as câmeras
- **Contagem de visitantes distintos** — por PDV/dia (embedding-based)
- **Thumbnails** — geração on-the-fly de thumbnails de gravações via FFmpeg
- **Object Storage S3** — gravações na nuvem, disco local como buffer
- **S3 Migration** — batch migration com pause/resume/cancel
- **Multi-tenant** — isolamento por tenant_id em todas as tabelas
- **API interna** — endpoints para o Control gerenciar tenants/câmeras
- **Docker cleanup remoto** — limpar imagens/cache via dashboard
- **S3 health monitoring** — status de conectividade e uso no dashboard

## Stack

| Componente | Tecnologia |
|-----------|-----------|
| Servidor RTMP | Nginx-RTMP |
| API Backend | Node.js 20 + Express 4 (ESM) |
| Face Service | Python 3.11 + InsightFace buffalo_l + YOLO26n (FastAPI) |
| Banco de Dados | PostgreSQL 16 + pgvector |
| Object Storage | Contabo S3 (AWS SDK compatible) |
| Dashboard | React 18 + TypeScript + Vite + HLS.js |
| CI/CD | GitHub webhook → deploy automático |

## Containers (5)

| Container | Porta | Função |
|-----------|:-----:|--------|
| nginx-rtmp | 1935, 8080 | Recebe RTMP, serve HLS e stats |
| api | 8000 | Backend REST + 7 serviços background |
| face-service | 8001 | InsightFace + YOLO26n (limite 2GB RAM) |
| dashboard | 3000 | React SPA (Nginx Alpine) |
| db | 5432 | PostgreSQL 16 + pgvector |

## Quick Start

```bash
git clone https://github.com/andrelealpb/FlacGuard.git
cd FlacGuard
cp .env.example .env
# Edite .env: JWT_SECRET, S3 (opcional), INTERNAL_API_KEY
docker compose up -d
# Migrations rodam automaticamente
# Dashboard: http://localhost:3000 (setup do primeiro admin)
# API: http://localhost:8000/health
# RTMP: rtmp://localhost:1935/live/{stream_key}
# Face Service: http://localhost:8001/health
```

## Infraestrutura em produção

| Recurso | Detalhe |
|---------|---------|
| VPS | Contabo Cloud VPS 20 NVMe (6 vCPU, 12GB, US-Central) |
| IP | 147.93.141.133 |
| S3 | Contabo Object Storage 250GB (US-Central) |
| Dashboard | guard.flactech.com.br |
| API | api-guard.flactech.com.br |
| RTMP | rtmp-guard.flactech.com.br:1935 |

## Endpoints internos (para o Control)

Auth: `X-Internal-Key` header. Env: `INTERNAL_API_KEY`.

```
GET    /api/internal/health              # Health check
POST   /api/internal/tenants             # Criar tenant (gera admin + password)
DELETE /api/internal/tenants/:id         # Desativar tenant
PUT    /api/internal/tenants/:id/limits  # Atualizar plano/limites
GET    /api/internal/tenants/:id/usage   # Stats: câmeras, PDVs, storage
```

## API (endpoints do dashboard)

### Auth
```
POST   /api/auth/login          POST   /api/auth/setup
POST   /api/auth/register
```

### Câmeras
```
GET    /api/cameras              POST   /api/cameras
GET    /api/cameras/:id          PATCH  /api/cameras/:id
DELETE /api/cameras/:id          GET    /api/cameras/:id/live
GET    /api/cameras/:id/recordings
GET    /api/cameras/:id/recording
GET    /api/cameras/:id/snapshot GET    /api/cameras/:id/download
GET    /api/cameras/models       GET    /api/cameras/stream-names
GET    /api/cameras/disk-usage
```

### Gravações
```
GET    /api/recordings           GET    /api/recordings/by-day
GET    /api/recordings/:id/stream  GET  /api/recordings/:id/download
GET    /api/recordings/:id/thumbnail
POST   /api/recordings/cleanup
POST   /api/recordings/:id/detect-faces
POST   /api/recordings/:id/search-face
```

### S3 Migration
```
GET    /api/monitor/s3           POST   /api/monitor/s3/migrate
GET    /api/monitor/s3/migrate   POST   /api/monitor/s3/migrate/pause|resume|cancel
POST   /api/monitor/cleanup
GET    /api/monitor/system       GET    /api/monitor/stats
GET    /api/monitor/disk-breakdown
```

### Face Recognition + Persons
```
POST   /api/faces/search         GET    /api/faces/status
GET    /api/faces/watchlist      POST   /api/faces/watchlist
POST   /api/faces/watchlist/from-appearance
PATCH  /api/faces/watchlist/:id  DELETE /api/faces/watchlist/:id
GET    /api/faces/watchlist/:id/photo
GET    /api/faces/alerts         PATCH  /api/faces/alerts/:id/acknowledge
GET    /api/faces/visitors       POST   /api/faces/visitors/compute
GET    /api/faces/persons        POST   /api/faces/persons
GET    /api/faces/persons/:id    PATCH  /api/faces/persons/:id
DELETE /api/faces/persons/:id
POST   /api/faces/persons/from-embedding
POST   /api/faces/persons/:id/add-embeddings
POST   /api/faces/persons/:id/search
POST   /api/faces/persons/:id/watchlist
POST   /api/faces/reimport       GET    /api/faces/reimport/status
GET    /api/faces/image
```

### PDVs
```
GET    /api/pdvs                 POST   /api/pdvs
GET    /api/pdvs/:id             PATCH  /api/pdvs/:id
GET    /api/pdvs/:id/events      GET    /api/pdvs/:id/visitors
POST   /api/pdvs/sync            GET    /api/pdvs/pulse-status
```

## Migrations (11)

001-006: PDVs, settings, camera config, face recognition, person linking, alerts/quota
007: camera_purpose (environment/face) + capture_face
008: multi-tenant (tenant_id em todas tabelas)
008: persons (perfis nomeados de embeddings)
009: S3 storage (s3_key)
010: campos de plano no tenants (max_pdvs, retention_days, features)

## Câmeras suportadas

| Modelo | RTMP | Tipo |
|--------|:----:|------|
| Intelbras iM3 C | ✅ | Wi-Fi indoor |
| Intelbras iM5 SC | ✅ | Wi-Fi indoor, pan/tilt |
| Intelbras iMX | ✅ | Wi-Fi indoor |
| Intelbras IC3 | ❌ (Pi Zero) | Wi-Fi |
| Intelbras IC5 | ❌ (Pi Zero) | Wi-Fi |

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura completa (v7.0, nó + control) |
| [docs/SETUP_S3_CONTABO.md](docs/SETUP_S3_CONTABO.md) | Config S3 |
| [docs/MIGRACAO_NOVO_SERVIDOR.md](docs/MIGRACAO_NOVO_SERVIDOR.md) | Migração VPS |
| [docs/cameras.md](docs/cameras.md) | Inventário câmeras |
| [docs/rtmp-setup.md](docs/rtmp-setup.md) | Config Mibo Smart |
| [docs/vps-setup.md](docs/vps-setup.md) | Setup VPS |
| [docs/API_EXTERNAL_ACCESS.md](docs/API_EXTERNAL_ACCESS.md) | Integração Pulse |
| [agent/README.md](agent/README.md) | Pi Zero |

## Repositórios

| Repo | Função |
|------|--------|
| [FlacGuard](https://github.com/andrelealpb/FlacGuard) | Nó de processamento (este) |
| [flac-guard-control](https://github.com/andrelealpb/flac-guard-control) | Control: dashboard, gateway, billing |

## Deploy

```
git push → webhook :9000 → deploy.sh → build → up -d → health check
```

## Licença

Proprietary — Flac Tech © 2026
