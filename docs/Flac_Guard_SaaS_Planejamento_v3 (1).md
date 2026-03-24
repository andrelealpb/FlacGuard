# Flac Guard SaaS — Planejamento Completo (v3)

> Março 2026 | Versão definitiva
> Domínio: flactech.com.br (registro Registro.br, DNS Cloudflare)
> Decisões-chave: VPS 30 como célula (~40 câm), multi-nó por tenant,
> dashboard unificado no Control (vídeo direto nó/S3), Cloudflare DNS API,
> deploy multi-nó via Control

---

## 1. Consumo Real por Câmera

| Tipo | CPU/câmera | RAM/câmera | S3/dia |
|------|:----------:|:----------:|:------:|
| Ambiente com +face | 0.18 vCPU | 100 MB | 0.65 GB |
| Facial dedicada | 0.12 vCPU | 80 MB | 0.49 GB |

Overhead fixo por nó: 1.0 vCPU + 3.2 GB RAM (OS, Docker, face-service, DB).

---

## 2. Célula padrão: VPS 30 ($12/mês)

8 vCPU, 24 GB RAM. Capacidade: **~40 câmeras** (mix 60/40). Melhor custo/vCPU.

---

## 3. Arquitetura

```
Control (VPS 10, $3.96) — só JSON, nunca vídeo
  ├── guard.flactech.com.br    Dashboard cliente (React SPA)
  ├── app.flactech.com.br      Dashboard admin
  ├── flactech.com.br           Landing page
  ├── api.flactech.com.br       Gateway API
  ├── Stripe billing
  ├── Contabo API (provisionar VPS)
  ├── Cloudflare API (criar DNS)
  └── Deploy hub (recebe GitHub webhook → redistribui para nós)
         │
         ├── node-1.flactech.com.br (VPS 30, ~40 câm, HTTPS)
         ├── node-2.flactech.com.br (VPS 30, ~40 câm, HTTPS)
         └── node-N.flactech.com.br (VPS 30, ~40 câm, HTTPS)
                    │
                    └── Contabo S3 (auto-scaling)
                        Browser ←HLS direto→ nó
                        Browser ←pre-signed URL→ S3
```

---

## 4. Multi-nó por Tenant

| Tamanho | Câmeras | Nós |
|---------|:-------:|:---:|
| Tester (1 PDV) | 3 | Compartilhado |
| Pequeno (5-10 PDVs) | 15-30 | 1 |
| Médio (15-30 PDVs) | 45-90 | 2-3 |
| Grande (50-100 PDVs) | 150-300 | 4-8 |

Auto-scaling: 85% capacidade → Control provisiona novo nó automaticamente (~3-5 min).

---

## 5. Deploy e Atualizações

### Novo nó (provisionamento automático)

```
Control → Contabo API (VPS 30) → Cloudflare API (DNS) → cloud-init:
  Docker + git clone + .env injetado + docker compose up
  + Certbot SSL + Nginx HTTPS + webhook service
→ Health check → status 'active' → pronto
Tempo: ~3-5 min, zero intervenção manual
```

### Atualização de código (deploy multi-nó)

```
Dev push GitHub → webhook → Control
  → Control redistribui para TODOS os nós em paralelo
  → Cada nó: git pull → build → up -d → health check
  → Control registra status/tempo/commit por nó
  → Admin dashboard mostra resultado em tempo real
  → Se falhou → retry 1x → alerta admin
```

---

## 6. Caso HappyDo

| Dado | Valor |
|------|:-----:|
| PDVs | 66 |
| Câmeras monitoramento | 89 |
| Câmeras facial (1/PDV grátis) | 65 |
| **Total** | **154** |
| Nós necessários | **4× VPS 30** |
| S3 (21 dias) | ~1.88 TB |

| Item | Custo/mês |
|------|:---------:|
| 4× VPS 30 | $48.00 |
| S3 (~2 TB) | $23.92 |
| **Total** | **~$72 (~R$ 400)** |
| **Receita** (89 × R$ 49,90) | **R$ 4.441** |
| **Margem** | **91%** |

---

## 7. Planos e Preços

| | Tester | Monitoring | Advanced | Ultra |
|---|:---:|:---:|:---:|:---:|
| Preço/câmera | Grátis | R$ 49,90 | R$ 59,90 | R$ 44,90 |
| PDVs | 1 | 30 | 100 | 300 |
| Câm/PDV | 2 | 3 | 3 | 3 |
| Facial grátis/PDV | 1 | 1 | 1 | 1 |
| Retenção | 14d | 21d | 21d | 21d |

Cobrança por câmera ativa + 1 facial grátis/PDV. Stripe per-unit.

---

## 8. Billing — Stripe

Checkout com per-unit pricing, free tier direto, cupons, 7 eventos de webhook, portal self-service, proration automática.

Email: Google Workspace (corporativo) + Brevo SMTP (transacional).

---

## 9. Custos mensais (SaaS rodando)

| Item | Custo |
|------|:-----:|
| VPS 10 (Control) | $3.96 |
| VPS 30 (testers compartilhado) | $12.00 |
| VPS 30 (HappyDo, 4 nós) | $48.00 |
| S3 (HappyDo ~2 TB + testers) | $26.91 |
| Cloudflare + Brevo | Grátis |
| Google Workspace | ~$7.00 |
| **Total** | **~$98 (~R$ 540)** |

---

## 10. Status e Próximos Passos

### Concluído ✅

**Nó:**
- Multi-tenant + S3 + face recognition + persons + thumbnails
- Endpoints internos (routes/internal.js)
- Migration 010 (campos de plano)
- S3 health + Docker cleanup remoto
- Deploy automático (webhook + deploy.sh)

**Control:**
- Schema + admin API + auth + billing (Stripe completo)
- Admin dashboard (5 páginas) + landing (4 páginas)
- Contabo API + provisioning + email + node-health
- Scripts Stripe (sync-plans, setup-webhook)
- Nginx rate limiting + SSL hardening

### Próximo: implementação multi-nó

Fases 1-9 no Plano de Mudanças: infra → HTTPS nós → Control multi-nó → gateway → dashboard cliente → deploy multi-nó → HappyDo go-live

### Projeção 30.000 PDVs

| | Custo/mês | Receita/mês |
|--|:---------:|:-----------:|
| ~1.875 nós + S3 | R$ 174.000 | R$ 3.525.000 |
| **Margem** | | **~95%** |
