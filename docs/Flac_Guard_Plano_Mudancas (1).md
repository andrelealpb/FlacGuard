# Flac Guard — Plano de Mudanças Detalhado

> Documento operacional para implementação
> Março 2026 | Versão definitiva
> Objetivo: transformar a arquitetura atual em SaaS multi-nó com dashboard unificado

---

## 1. Resumo da mudança

### Antes (atual)
- 1 VPS com tudo (API + dashboard + RTMP + face-service + DB)
- Cliente acessa o dashboard direto no VPS
- 1 tenant (HappyDo), 5 câmeras
- Deploy: GitHub webhook direto no VPS

### Depois
- VPS de Control (VPS 10, leve) → serve dashboard React + API gateway JSON
- N nós de processamento (VPS 30) → recebem RTMP, gravam, processam facial
- Vídeo (live e playback) vai direto do browser para o nó/S3, sem passar pelo Control
- Control consolida dados JSON de todos os nós de forma transparente
- Deploy: GitHub webhook → Control → redistribui para todos os nós
- Provisionamento: Control cria VPS + DNS + SSL automaticamente

### Por que o vídeo não passa pelo Control?
- HLS live: ~1 Mbps por câmera assistida. 40 streams = 40 Mbps constante
- VPS 10 tem 200 Mbit/s, ficaria saturado
- Browser conecta direto no nó (HLS) ou no S3 (playback) = zero carga de vídeo no Control

---

## 2. DNS — Plano completo

### DNS atual (Registro.br, tudo aponta pro VPS 20: 147.93.141.133)

```
A   api-guard.flactech.com.br      147.93.141.133
A   deploy-guard.flactech.com.br   147.93.141.133
A   guard.flactech.com.br          147.93.141.133
A   hls-guard.flactech.com.br      147.93.141.133
A   rtmp-guard.flactech.com.br     147.93.141.133
A   ssh-guard.flactech.com.br      147.93.141.133
```

### DNS novo (Cloudflare)

```
# CONTROL (VPS 10)
A   flactech.com.br                 [IP Control]    Landing page
A   www.flactech.com.br             [IP Control]    Landing page
A   guard.flactech.com.br           [IP Control]    Dashboard cliente
A   app.flactech.com.br             [IP Control]    Dashboard admin
A   api.flactech.com.br             [IP Control]    API gateway

# NÓS (criados automaticamente via Cloudflare API)
A   node-1.flactech.com.br          147.93.141.133  Nó 1 (HLS + RTMP + API interna)
A   node-2.flactech.com.br          [IP nó 2]       Nó 2
A   node-N.flactech.com.br          [IP nó N]       Nó N

# REMOVER
api-guard, hls-guard, rtmp-guard, deploy-guard, ssh-guard

# EMAIL (Google Workspace + Brevo)
MX  → Google Workspace
TXT → SPF (Google + Brevo), DKIM (Google + Brevo), DMARC
```

### Migrar DNS para Cloudflare

1. Criar conta Cloudflare → adicionar flactech.com.br
2. Importar registros automaticamente
3. No Registro.br: trocar nameservers para Cloudflare
4. Anotar API Token + Zone ID (para Control criar DNS via API)

---

## 3. O que muda no NÓ (repo FlacGuard)

### Já implementado ✅

- `routes/internal.js` (268 linhas): health, tenants CRUD, limits, usage
- `Migration 010`: campos de plano no tenants (max_pdvs, features, etc)
- `INTERNAL_API_KEY` no .env
- Persons CRUD completo (faces.js, 986 linhas)
- Thumbnails on-the-fly (recordings.js)
- S3 health + Docker cleanup (monitor.js, 594 linhas)

### A implementar

| Item | Descrição |
|------|-----------|
| HTTPS no nó | Certbot + Nginx no host (node-N.flactech.com.br) |
| CORS | Aceitar requests de guard.flactech.com.br |
| Nginx host config | /hls/ com CORS, /api/internal/, / → 404 |
| Deploy webhook service | Já existe, incluir no cloud-init |
| Remover dashboard (opcional) | Container dashboard pode ser removido após client-dashboard no Control |

---

## 4. O que muda no CONTROL (repo flac-guard-control)

### Já implementado ✅

- Schema (plans, nodes, tenants, admin_users, billing_events, node_health_log)
- 8 routes: admin-auth, admin-dashboard, admin-tenants, admin-nodes, admin-billing, billing, internal, plans
- 6 services: stripe (304 linhas), email, contabo, provisioning, node-health, auth
- Admin dashboard (5 páginas): Dashboard, Tenants, Nodes, Billing, Login
- Landing page (4 páginas): index, pricing, checkout, welcome
- Stripe: checkout, webhooks (7 eventos), portal, free tier, coupons
- Scripts: stripe-sync-plans, stripe-setup-webhook
- Nginx config com rate limiting + SSL hardening

### A implementar

| Item | Descrição |
|------|-----------|
| **Cloudflare API** | services/cloudflare.js (criar/deletar DNS A records) |
| **tenant_nodes (N:N)** | Evoluir schema de node_id → tenant_nodes + camera_node_map |
| **Gateway multi-nó** | services/gateway.js + routes gateway-*.js |
| **Dashboard cliente** | client-dashboard/ (React, cópia adaptada do nó) |
| **Cloud-init completo** | .env injetado, Certbot, Nginx, webhook service |
| **Deploy multi-nó** | POST /api/admin/deploy → redistribui para todos os nós |
| **Deploy status por nó** | Admin dashboard mostra status deploy em cada nó |

---

## 5. Deploy e Atualizações

### Setup inicial de novo nó (provisionamento)

```
1. Control detecta necessidade (câmeras > 85% slots)
   ou admin clica "Provisionar nó"

2. Contabo API: criar VPS 30 NVMe (US-Central)
   → cloud-init com .env completo:
     JWT_SECRET=[gerado]
     INTERNAL_API_KEY=[gerado, salvo no Control]
     S3_ENDPOINT=https://usc1.contabostorage.com
     S3_BUCKET=flac-guard-recordings
     S3_ACCESS_KEY=[do tenant ou compartilhado]
     S3_SECRET_KEY=[do tenant ou compartilhado]
     POSTGRES_PASSWORD=[gerado]
     WEBHOOK_SECRET=[gerado, para deploy]

3. Cloudflare API: criar DNS node-N.flactech.com.br → IP

4. Cloud-init executa no VPS:
   a. Instala Docker, git, Nginx, Certbot
   b. git clone FlacGuard /opt/FlacGuard
   c. Gera .env com valores injetados
   d. docker compose up -d --build
   e. Aguarda DB healthy → roda migrations
   f. Certbot SSL (node-N.flactech.com.br)
   g. Nginx config (HTTPS: /hls/ com CORS, /api/internal/)
   h. Instala deploy webhook service (porta 9000, systemd)

5. Control faz health check loop:
   GET https://node-N.flactech.com.br/api/internal/health
   → Quando OK → status = 'active'

6. Registra nó no banco + tenant_nodes

Tempo total: ~3-5 minutos, zero intervenção manual
```

### Atualização de nós existentes (deploy)

```
1. Dev faz push no GitHub (branch main)

2. GitHub webhook → Control
   POST https://api.flactech.com.br/api/admin/deploy
   headers: { 'X-Hub-Signature-256': hmac }

3. Control (POST /api/admin/deploy):
   a. Valida assinatura GitHub
   b. Busca todos os nós com status = 'active'
   c. Para cada nó em PARALELO:
      POST https://node-N.flactech.com.br:9000/deploy
        headers: { 'X-Hub-Signature-256': hmac(node_webhook_secret, body) }
   d. Aguarda resposta de cada nó (timeout 5 min)
   e. Salva relatório:
      { node_id, status: 'success'|'failed', duration_ms, commit_hash }
   f. Se algum falhou → retry 1x → se falhou de novo → alerta admin

4. Cada nó ao receber webhook:
   deploy.sh:
     git pull origin main
     docker compose build --no-cache [serviço que mudou]
     docker compose up -d
     health check (todos containers + DB + face-service)
     deploy-status.json

5. Admin dashboard (Nodes.jsx):
   - Coluna "Último deploy" com status e timestamp
   - Botão "Deploy manual" por nó
   - Botão "Deploy todos" (sem esperar GitHub)
```

### Rollback

Se o deploy quebra um nó:
- deploy.sh detecta health check failure
- O nó fica com containers antigos rodando (docker compose up -d não mata se build falhou)
- Admin pode forçar rollback via SSH: `git checkout HEAD~1 && docker compose up -d --build`
- Futuro: deploy.sh com git stash + rollback automático se health check falha

---

## 6. Ordem de implementação (passo a passo)

### Fase 1: Infraestrutura (manual, ~2h)

```
1.1  Provisionar VPS 10 no Contabo (Control) → anotar IP
1.2  Criar conta Cloudflare → adicionar flactech.com.br
1.3  No Registro.br: trocar nameservers para Cloudflare
1.4  Aguardar propagação DNS (~1-2h)
1.5  No Cloudflare: criar registros (seção 2)
1.6  No VPS Control: Docker, Nginx, Certbot
1.7  SSL: certbot para flactech.com.br, guard, app, api
1.8  No VPS nó 1: certbot para node-1.flactech.com.br
1.9  Configurar GitHub webhook → api.flactech.com.br/api/admin/deploy
```

### Fase 2: HTTPS + CORS no nó (Claude Code, repo FlacGuard, ~2h)

```
2.1  Nginx host config: /hls/ CORS + /api/internal/ + HTTPS
2.2  CORS em routes/internal.js para guard.flactech.com.br
2.3  Deploy no nó 1 → testar HLS via HTTPS
```

### Fase 3: Control — evolução multi-nó (Claude Code, repo flac-guard-control, ~4h)

```
3.1  Migration: tenant_nodes (N:N) + camera_node_map
3.2  services/cloudflare.js (criar/deletar DNS)
3.3  Atualizar contabo.js: cloud-init completo com .env injetado
3.4  Atualizar provisioning.js: Contabo + Cloudflare + health check
3.5  POST /api/admin/deploy (redistribuir webhook para nós)
3.6  Deploy status por nó no admin dashboard
```

### Fase 4: Gateway multi-nó (Claude Code, ~6h)

```
4.1  services/gateway.js (queryAllNodes, merge, proxy, findCameraNode)
4.2  gateway-auth.js (login cliente)
4.3  gateway-cameras.js (GET consolidado, POST com seleção nó)
4.4  gateway-cameras.js live (URL HTTPS do nó direto)
4.5  gateway-recordings.js (lista merge, stream via pre-signed URL do S3)
4.6  gateway-faces.js (search distribuído, watchlist replicada, persons)
4.7  gateway-pdvs.js, gateway-events.js, gateway-monitor.js
```

### Fase 5: Dashboard cliente (Claude Code, ~4h)

```
5.1  Clonar/adaptar dashboard do nó para client-dashboard/
5.2  URLs absolutas para HLS (node-N.flactech.com.br) e S3
5.3  Auth via gateway
5.4  Testar: live, playback, cameras, faces, persons, monitor
```

### Fase 6: Stripe (Claude Code, ~2h)

```
6.1  Stripe já implementado — ajustar para multi-nó
6.2  Webhook flow: checkout → criar tenant → alocar nós → cloud-init
6.3  Testar ciclo completo
```

### Fase 7: Landing page (já implementada, ~1h ajustes)

```
7.1  Ajustar URLs se necessário
7.2  Deploy no Control
```

### Fase 8: Email (manual + Claude Code, ~2h)

```
8.1  Google Workspace + Brevo
8.2  DNS no Cloudflare: MX, SPF, DKIM, DMARC
8.3  Testar envio/recebimento
```

### Fase 9: HappyDo go-live (~3h)

```
9.1  Upgrade VPS 20 → VPS 30 (ou manter como nó 1)
9.2  Provisionar nós 2, 3, 4 (via Control)
9.3  Deploy automático configura tudo (cloud-init + DNS + SSL)
9.4  Distribuir 154 câmeras nos 4 nós
9.5  S3 auto-scaling cap 2.5 TB
9.6  Testar dashboard unificado + deploy multi-nó
9.7  Monitorar 48h
```

---

## 7. Custos pós-implementação

| Item | Qtd | Custo/mês |
|------|:---:|:---------:|
| VPS 10 (Control) | 1 | $3.96 |
| VPS 30 (nó compartilhado testers) | 1 | $12.00 |
| VPS 30 (nós HappyDo) | 4 | $48.00 |
| S3 HappyDo (~2 TB) | 8 slots | $23.92 |
| S3 testers (~50 GB) | 1 slot | $2.99 |
| Cloudflare | — | Grátis |
| Google Workspace | 1 user | ~$7.00 |
| Brevo | — | Grátis |
| **Total** | | **~$98 (~R$ 540)** |

Receita HappyDo: 89 câm × R$ 49,90 = R$ 4.441/mês → **margem 88%**
