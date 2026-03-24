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
- **Multi-nó** — um cliente pode ter N nós de processamento, transparente
- **Object Storage S3** — gravações na nuvem, disco local como buffer

## Arquitetura

```
                    ┌─────────────────────────┐
                    │   Control (VPS 10)       │
                    │   guard.flactech.com.br  │
                    │   Dashboard + Gateway    │
                    │   Só JSON, nunca vídeo   │
                    └──────────┬──────────────┘
                               │ JSON
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  Nó 1    │    │  Nó 2    │    │  Nó N    │
        │  VPS 30  │    │  VPS 30  │    │  VPS 30  │
        │ ~40 câm  │    │ ~40 câm  │    │ ~40 câm  │
        └────┬─────┘    └────┬─────┘    └────┬─────┘
             │               │               │
             ▼               ▼               ▼
        ┌──────────────────────────────────────┐
        │         Contabo S3 (gravações)       │
        └──────────────────────────────────────┘

Live:     Browser ←── HLS direto ──→ Nó
Playback: Browser ←── pre-signed URL ──→ S3
```

O cliente acessa um único URL (guard.flactech.com.br). O Control consulta todos os nós em paralelo e apresenta tudo junto. O vídeo vai direto do browser para o nó (HLS) ou para o S3 (playback), sem passar pelo Control.

## Stack

| Componente | Tecnologia | Onde |
|-----------|-----------|------|
| Dashboard cliente | React 18 + TypeScript + Vite + HLS.js | Control |
| Gateway API | Node.js 20 + Express (ESM) | Control |
| Billing | Stripe SDK | Control |
| DNS automático | Cloudflare API | Control |
| Provisioning | Contabo API | Control |
| Servidor RTMP | Nginx-RTMP | Nó |
| API Backend | Node.js 20 + Express (ESM) | Nó |
| Face Service | Python 3.11 + InsightFace + YOLO26n (FastAPI) | Nó |
| Banco de Dados | PostgreSQL 16 + pgvector | Nó |
| Object Storage | Contabo S3 (AWS SDK) | Compartilhado |
| CI/CD | GitHub webhook → deploy automático | Nó |

## Infraestrutura

| Recurso | Detalhe |
|---------|---------|
| Control | Contabo VPS 10 ($3.96/mês) |
| Nó de processamento | Contabo VPS 30 ($12/mês, ~40 câmeras cada) |
| S3 | Contabo Object Storage (US-Central, auto-scaling) |
| DNS | Cloudflare (grátis, API para criar node-N automaticamente) |
| Domínio | flactech.com.br |
| Dashboard | [guard.flactech.com.br](https://guard.flactech.com.br) |
| RTMP | rtmp://node-N.flactech.com.br:1935/live/{stream_key} |

## Este repositório (Nó de processamento)

Este repo é o **nó de processamento**. Cada nó roda 4 containers:

| Container | Porta | Função |
|-----------|:-----:|--------|
| nginx-rtmp | 1935, 8080 | Recebe RTMP, serve HLS |
| api | 8000 | Backend REST + serviços background + endpoints internos |
| face-service | 8001 | InsightFace + YOLO26n (limite 2GB RAM) |
| db | 5432 | PostgreSQL 16 + pgvector |

O dashboard do cliente **não roda no nó** — roda no Control.

### Quick Start (nó standalone para desenvolvimento)

```bash
git clone https://github.com/andrelealpb/FlacGuard.git
cd FlacGuard
cp .env.example .env
docker compose up -d
# Migrations rodam automaticamente
# API: http://localhost:8000/health
# HLS: http://localhost:8080/hls/{stream_key}.m3u8
# RTMP: rtmp://localhost:1935/live/{stream_key}
```

## API do Nó

### Endpoints internos (chamados pelo Control)

Auth: `X-Internal-Key` header.

```
POST   /api/internal/tenants                    # Criar tenant
GET    /api/internal/cameras                     # Listar câmeras do tenant
POST   /api/internal/cameras                     # Criar câmera
GET    /api/internal/cameras/:id/live            # URL HLS
GET    /api/internal/recordings                  # Listar gravações
GET    /api/internal/recordings/:id/stream       # Pre-signed URL S3
POST   /api/internal/faces/search               # Busca facial (pgvector local)
GET    /api/internal/faces/watchlist             # Watchlist
GET    /api/internal/faces/visitors              # Visitantes
GET    /api/internal/pdvs                        # PDVs
GET    /api/internal/monitor/system              # Stats do nó
POST   /api/internal/usage                       # Reportar uso ao Control
```

### Endpoints legados (ainda funcionais, auth JWT/API Key)

```
POST   /api/auth/login
GET    /api/cameras, /api/recordings, /api/events
POST   /api/faces/search, /api/faces/watchlist
GET    /api/pdvs, /api/monitor/system, /api/alerts
```

### S3 Migration

```
POST   /api/recordings/s3-migrate               # Iniciar migração batch
GET    /api/recordings/s3-migrate/status         # Progresso
POST   /api/recordings/s3-migrate/pause|resume|cancel
```

## Câmeras suportadas

| Modelo | RTMP nativo | Tipo |
|--------|:----------:|------|
| Intelbras iM3 C | ✅ | Wi-Fi indoor |
| Intelbras iM5 SC | ✅ | Wi-Fi indoor, pan/tilt |
| Intelbras iMX | ✅ | Wi-Fi indoor |
| Intelbras IC3 | ❌ (Pi Zero) | Wi-Fi |
| Intelbras IC5 | ❌ (Pi Zero) | Wi-Fi |

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura completa (v6.0, inclui Control + multi-nó) |
| [docs/cameras.md](docs/cameras.md) | Inventário de câmeras |
| [docs/rtmp-setup.md](docs/rtmp-setup.md) | Config RTMP no app Mibo Smart |
| [docs/vps-setup.md](docs/vps-setup.md) | Setup do VPS |
| [docs/SETUP_S3_CONTABO.md](docs/SETUP_S3_CONTABO.md) | Config Object Storage S3 |
| [docs/MIGRACAO_NOVO_SERVIDOR.md](docs/MIGRACAO_NOVO_SERVIDOR.md) | Migração/upgrade de VPS |
| [docs/Plano_Escala_Fase_2_5.md](docs/Plano_Escala_Fase_2_5.md) | Plano de escala |
| [docs/API_EXTERNAL_ACCESS.md](docs/API_EXTERNAL_ACCESS.md) | Integração HappyDoPulse |
| [agent/README.md](agent/README.md) | Setup Pi Zero para câmeras IC |

## Repositórios relacionados

| Repo | Função |
|------|--------|
| [FlacGuard](https://github.com/andrelealpb/FlacGuard) | Nó de processamento (este repo) |
| [flac-guard-control](https://github.com/andrelealpb/flac-guard-control) | Control: dashboard, gateway, billing, provisioning |

## Deploy

Push na branch `main` dispara deploy automático via webhook:

```
git push → webhook :9000 → deploy.sh →
  git pull → docker compose build → docker compose up -d →
  health check → deploy-status.json
```

## Licença

Proprietary — Flac Tech © 2026
