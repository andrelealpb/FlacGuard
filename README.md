# Flac Guard

Sistema centralizado de vídeo monitoramento para ~80 câmeras MIBO Intelbras em mercadinhos autônomos da Happydo Mercadinhos (João Pessoa/PB).

## Arquitetura

**RTMP-first**: câmeras empurram vídeo (outbound) para o servidor cloud, sem necessidade de configurar roteadores nos PDVs.

- **Grupo 1** (~57 câmeras iM): RTMP nativo direto para o servidor, zero hardware no PDV
- **Grupo 2** (~23 câmeras IC): Pi Zero 2 W como tradutor RTSP → RTMP

```
[Câmeras iM] ──RTMP──→ [Nginx-RTMP] → [Gravação + HLS]
[Câmeras IC] ──RTSP──→ [Pi Zero] ──RTMP──→ [Nginx-RTMP]
                                              ↓
                                    [API REST (Node.js)]
                                              ↓
                                    [Dashboard Web (React)]
```

## Stack

| Componente | Tecnologia |
|-----------|-----------|
| Servidor RTMP | Nginx-RTMP |
| API Backend | Node.js + Express |
| Banco de Dados | PostgreSQL 16 |
| Dashboard | React 18 + TypeScript + Vite |
| Player de Vídeo | HLS.js |
| Containerização | Docker + Docker Compose |
| CI/CD | GitHub Actions |

## Quick Start

```bash
# 1. Clone
git clone https://github.com/andrelealpb/FlacGuard.git
cd FlacGuard

# 2. Configure
cp .env.example .env

# 3. Suba os serviços
docker compose up -d

# 4. Execute as migrations
docker compose exec api node src/db/migrate.js

# 5. Acesse
# Dashboard:  http://localhost:3000
# API Docs:   http://localhost:8000/health
# RTMP Ingest: rtmp://localhost:1935/live/{stream_key}
```

## API Endpoints

```
POST   /api/auth/login                     # Login (JWT)
POST   /api/auth/register                  # Registrar usuário (admin)

GET    /api/cameras                        # Listar câmeras com status
POST   /api/cameras                        # Cadastrar câmera (gera stream key)
GET    /api/cameras/:id/live               # URL do stream HLS
GET    /api/cameras/:id/recordings         # Listar gravações por período
GET    /api/cameras/:id/recording          # Buscar por timestamp exato
GET    /api/cameras/:id/snapshot           # Frame atual (JPEG)
GET    /api/cameras/:id/download           # Download trecho MP4

GET    /api/pdvs                           # Listar PDVs com câmeras e status
GET    /api/pdvs/:id                       # Detalhes do PDV
GET    /api/pdvs/:id/events                # Eventos de um PDV

GET    /api/events                         # Todos os eventos
GET    /api/recordings                     # Todas as gravações
POST   /api/webhooks                       # Cadastrar webhooks
```

Autenticação: **JWT** (dashboard) ou **API Key** (`X-API-Key` header) para integrações server-to-server.

## Documentação

- [ARCHITECTURE.md](ARCHITECTURE.md) — Arquitetura completa do sistema
- [docs/cameras.md](docs/cameras.md) — Inventário de câmeras
- [docs/rtmp-setup.md](docs/rtmp-setup.md) — Como configurar RTMP no app Mibo Smart
- [docs/vps-setup.md](docs/vps-setup.md) — Como provisionar o VPS
- [agent/README.md](agent/README.md) — Setup do Pi Zero para câmeras IC

## Licença

Proprietary — Flac © 2026
