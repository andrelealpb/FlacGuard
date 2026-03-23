# Flac Guard

Sistema SaaS de vídeo monitoramento com reconhecimento facial para mercadinhos autônomos.

Desenvolvido pela [Flac Tech](https://flactech.com.br) — João Pessoa/PB.

## O que faz

- **Live centralizado** — assista qualquer câmera de qualquer PDV em tempo real
- **Gravação inteligente** — grava por detecção de movimento (~80% economia de storage)
- **Reconhecimento facial** — busque um suspeito por foto em todas as gravações
- **Watchlist** — cadastre rostos de interesse e receba alertas automáticos
- **Contagem de visitantes** — pessoas distintas por PDV/dia
- **Multi-tenant** — múltiplos clientes isolados no mesmo servidor
- **Object Storage S3** — gravações na nuvem, disco local como buffer

## Arquitetura

```
[Câmeras MIBO] ──RTMP push──→ [Nginx-RTMP] ──HLS──→ [Dashboard React]
                                    │
                         [Pipeline de Frames]
                         ├── Movimento → FFmpeg grava → S3
                         ├── Rostos → InsightFace → pgvector
                         └── Watchlist → match >85% → alerta
```

**RTMP-first**: câmeras empurram vídeo (outbound) para o servidor cloud, sem configurar roteadores nos PDVs.

**Multi-tenant**: cada cliente (tenant) tem seus dados isolados por `tenant_id`. Queries filtradas automaticamente.

## Stack

| Componente | Tecnologia |
|-----------|-----------|
| Servidor RTMP | Nginx-RTMP |
| API Backend | Node.js 20 + Express 4 (ESM) |
| Banco de Dados | PostgreSQL 16 + pgvector |
| Face Service | Python 3.11 + InsightFace + YOLO26n (FastAPI) |
| Object Storage | Contabo S3 (AWS SDK compatible) |
| Dashboard | React 18 + TypeScript + Vite + HLS.js |
| Containerização | Docker Compose (5 containers) |
| CI/CD | GitHub webhook → deploy automático |

## Infra em produção

| Recurso | Detalhe |
|---------|---------|
| VPS | Contabo Cloud VPS 20 NVMe (6 cores, 12GB RAM, US-Central) |
| S3 | Contabo Object Storage 250GB (US-Central, auto-scaling) |
| Domínio | flactech.com.br |
| Dashboard | [guard.flactech.com.br](https://guard.flactech.com.br) |
| API | [api-guard.flactech.com.br](https://api-guard.flactech.com.br) |
| RTMP | rtmp-guard.flactech.com.br:1935 |

## Quick Start

```bash
# 1. Clone
git clone https://github.com/andrelealpb/FlacGuard.git
cd FlacGuard

# 2. Configure
cp .env.example .env
# Edite .env com JWT_SECRET e credenciais S3 (opcional)

# 3. Suba os serviços
docker compose up -d

# 4. Migrations rodam automaticamente no boot da API
# Ou manualmente: docker compose exec api node src/db/migrate.js

# 5. Acesse
# Dashboard:   http://localhost:3000
# API:         http://localhost:8000/health
# RTMP Ingest: rtmp://localhost:1935/live/{stream_key}
# Face Service: http://localhost:8001/health
```

No primeiro acesso, o dashboard pede para criar o usuário admin (setup).

## Containers

| Container | Porta | Função |
|-----------|:-----:|--------|
| nginx-rtmp | 1935, 8080 | Recebe RTMP, serve HLS e stats |
| api | 8000 | Backend REST + 7 serviços background |
| face-service | 8001 | InsightFace + YOLO26n (limite 2GB RAM) |
| dashboard | 3000 | React SPA (Nginx Alpine) |
| db | 5432 | PostgreSQL 16 + pgvector |

## API Endpoints

### Auth
```
POST   /api/auth/login                     # JWT login
POST   /api/auth/setup                     # Criar primeiro admin
POST   /api/auth/register                  # Registrar usuário (admin only)
```

### Câmeras
```
GET    /api/cameras                        # Listar (filtros: pdv_id, status, model)
POST   /api/cameras                        # Cadastrar (gera stream key)
PUT    /api/cameras/:id                    # Atualizar config
DELETE /api/cameras/:id
GET    /api/cameras/:id/live               # URL HLS
GET    /api/cameras/:id/recordings         # Por período
GET    /api/cameras/:id/recording          # Por timestamp exato
```

### Gravações
```
GET    /api/recordings                     # Listar (filtros: camera_id, from, to)
GET    /api/recordings/by-day              # Timeline por dia
GET    /api/recordings/:id/stream          # Playback (S3 pre-signed URL ou local)
GET    /api/recordings/:id/download        # Download MP4
POST   /api/recordings/cleanup             # Forçar limpeza
POST   /api/recordings/:id/detect-faces    # Detectar rostos em gravação
POST   /api/recordings/:id/search-face     # Buscar rosto em gravações
```

### S3 Migration
```
GET    /api/recordings/s3-status           # Status do S3
POST   /api/recordings/s3-migrate          # Iniciar migração batch
GET    /api/recordings/s3-migrate/status   # Progresso
POST   /api/recordings/s3-migrate/pause
POST   /api/recordings/s3-migrate/resume
POST   /api/recordings/s3-migrate/cancel
```

### Face Recognition
```
POST   /api/faces/search                   # Upload foto → buscar aparições (admin)
GET    /api/faces/status                   # Status do serviço
GET    /api/faces/watchlist                # Listar watchlist
POST   /api/faces/watchlist                # Adicionar pessoa
DELETE /api/faces/watchlist/:id            # Remover
GET    /api/faces/alerts                   # Alertas de watchlist
GET    /api/faces/visitors                 # Visitantes/dia/PDV
```

### PDVs + Monitoramento
```
GET    /api/pdvs                           # PDVs com contagem de câmeras
POST   /api/pdvs/sync                     # Sincronizar do HappyDoPulse
GET    /api/monitor/system                 # CPU, RAM, disco, rede, Docker, S3
GET    /api/alerts                         # Alertas do sistema
GET    /api/events                         # Eventos (motion, online, offline)
POST   /api/webhooks                       # Cadastrar webhook
GET    /api/deploy-status                  # Status do último deploy
```

Autenticação: **JWT** (dashboard) ou **API Key** (`X-API-Key`) para integrações server-to-server.

## Câmeras suportadas

| Modelo | RTMP | Tipo |
|--------|:----:|------|
| Intelbras iM3 C | ✅ | Wi-Fi indoor |
| Intelbras iM5 SC | ✅ | Wi-Fi indoor, pan/tilt |
| Intelbras iMX | ✅ | Wi-Fi indoor |
| Intelbras IC3 | ❌ | Wi-Fi (via Pi Zero RTSP→RTMP) |
| Intelbras IC5 | ❌ | Wi-Fi (via Pi Zero RTSP→RTMP) |

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura completa (v5.0) |
| [docs/cameras.md](docs/cameras.md) | Inventário de câmeras |
| [docs/rtmp-setup.md](docs/rtmp-setup.md) | Config RTMP no app Mibo Smart |
| [docs/vps-setup.md](docs/vps-setup.md) | Setup do VPS Contabo |
| [docs/SETUP_S3_CONTABO.md](docs/SETUP_S3_CONTABO.md) | Config Object Storage S3 |
| [docs/MIGRACAO_NOVO_SERVIDOR.md](docs/MIGRACAO_NOVO_SERVIDOR.md) | Migração/upgrade de VPS |
| [docs/Plano_Escala_Fase_2_5.md](docs/Plano_Escala_Fase_2_5.md) | Plano de escala SaaS |
| [docs/API_EXTERNAL_ACCESS.md](docs/API_EXTERNAL_ACCESS.md) | Integração HappyDoPulse |
| [agent/README.md](agent/README.md) | Setup Pi Zero para câmeras IC |

## Deploy

Push na branch `main` dispara deploy automático via webhook:

```
git push → webhook :9000 → deploy.sh →
  git pull → docker compose build → docker compose up -d →
  health check → deploy-status.json
```

Status do deploy visível no dashboard (Configurações).

## Licença

Proprietary — Flac Tech © 2026
