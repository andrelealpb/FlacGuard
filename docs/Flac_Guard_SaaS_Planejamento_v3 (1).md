# Flac Guard SaaS — Planejamento Completo (v3)

> Documento de estratégia para o Flac Guard SaaS
> Março 2026 | Versão definitiva
> Domínio: flactech.com.br (registro no Registro.br, DNS no Cloudflare)
> Infra atual: Cloud VPS 20 NVMe (US-Central) + Contabo S3 250GB (US-Central)
> Decisões-chave:
>   - VPS 30 como célula padrão (~40 câmeras, $12/mês)
>   - Multi-nó por tenant (N:N)
>   - Dashboard unificado no Control (vídeo direto nó/S3, Control só JSON)
>   - DNS no Cloudflare (API para criar node-N.flactech.com.br)
>   - HTTPS em todos os nós (Certbot + node-N.flactech.com.br)

---

## 1. Consumo Real por Câmera (dados de produção)

### Medição: 5 câmeras, ~10 dias, VPS 20 (6 vCPU, 12 GB)

| Métrica | Valor medido |
|---------|:------------:|
| CPU total (5 câmeras) | 23% de 6 vCPU = 1.38 vCPU |
| RAM total | 2.2 GB de 11.7 GB |
| S3 acumulado | 22.3 GB (~10 dias) |
| Face embeddings | 51.364 |
| Gravações locais | 0 (tudo no S3) |

### Overhead fixo (containers, independe do nº de câmeras)

| Componente | CPU | RAM |
|-----------|:---:|:---:|
| OS + Docker | 0.3 vCPU | 800 MB |
| Face Service (InsightFace + YOLO) | 0.5 vCPU | 1.800 MB |
| API + Nginx-RTMP + DB | 0.2 vCPU | 600 MB |
| **Total fixo** | **1.0 vCPU** | **3.200 MB** |

### Consumo por câmera (líquido)

| Tipo | CPU/câmera | RAM/câmera | S3/dia |
|------|:----------:|:----------:|:------:|
| Ambiente com +face | 0.18 vCPU | 100 MB | 0.65 GB |
| Facial dedicada | 0.12 vCPU | 80 MB | 0.49 GB |
| Ambiente sem face | 0.08 vCPU | 60 MB | 0.40 GB |

---

## 2. Célula padrão: VPS 30

### Capacidade do VPS 30 (8 vCPU, 24 GB, $12/mês)

| Mix de câmeras | Câmeras por nó |
|---------------|:--------------:|
| 100% ambiente+face | ~31 |
| 100% facial dedicada | ~47 |
| Mix 60/40 (típico) | **~38-40** |

**Regra: max_cameras = 40 por VPS 30.**

Melhor custo/vCPU ($1.50 vs $1.73 VPS 40, $2.30 VPS 50). Granularidade boa: se um nó cai, ~40 câmeras offline (não 120). Todos iguais = mesmo cloud-init, mesmo setup.

---

## 3. Arquitetura SaaS

### Princípio: Control só trafega JSON, vídeo vai direto

O Control (VPS 10) serve o dashboard React e a API gateway. Quando o cliente assiste ao vivo ou playback, o browser conecta **direto no nó** (HLS) ou **direto no S3** (playback). O Control nunca trafega vídeo.

Isso permite usar um VPS 10 barato ($3.96) para o Control mesmo com centenas de câmeras.

### Diagrama

```
┌──────────────────────────────────────────────────┐
│        VPS DE CONTROLE (VPS 10, $3.96)            │
│        Só JSON, nunca vídeo                       │
│                                                    │
│  flactech.com.br        → Landing page            │
│  guard.flactech.com.br  → Dashboard cliente (SPA) │
│  app.flactech.com.br    → Dashboard admin         │
│  api.flactech.com.br    → API gateway             │
│                                                    │
│  Gateway (consulta nós em paralelo, merge JSON)    │
│  Stripe billing                                    │
│  Contabo API (provisionar VPS)                     │
│  Cloudflare API (criar DNS node-N.flactech.com.br)│
│  Brevo SMTP (emails transacionais)                 │
│  PostgreSQL (tenants, plans, nodes, tenant_nodes)  │
└──────────────────────────────────────────────────┘
          │ JSON only (API interna)
          ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  NÓ #1     │ │  NÓ #2     │ │  NÓ #N     │
│  VPS 30    │ │  VPS 30    │ │  VPS 30    │
│  $12/mês   │ │  $12/mês   │ │  $12/mês   │
│            │ │            │ │            │
│ node-1.flactech.com.br  (HTTPS)          │
│            │ │            │ │            │
│ Nginx-RTMP │ │ Nginx-RTMP │ │ Nginx-RTMP │
│ API Node.js│ │ API Node.js│ │ API Node.js│
│ Face Svc   │ │ Face Svc   │ │ Face Svc   │
│ PostgreSQL │ │ PostgreSQL │ │ PostgreSQL │
│            │ │            │ │            │
│ Browser ←──HLS direto──→ │ │            │
│ ~40 câmeras│ │ ~40 câmeras│ │ ~40 câmeras│
└────────────┘ └────────────┘ └────────────┘
          │              │              │
          ▼              ▼              ▼
┌──────────────────────────────────────────────────┐
│    CONTABO S3 (US-Central, auto-scaling)          │
│    Browser ←── pre-signed URL direto ──→ S3       │
│    recordings/{tenant}/{camera}/{date}/            │
└──────────────────────────────────────────────────┘
```

### Fluxo de vídeo (nunca passa pelo Control)

```
Live:
  Dashboard (Control) → GET /api/cameras/X/live
  → Control: "câmera X está no nó 2"
  → Retorna: { hls_url: "https://node-2.flactech.com.br/hls/key.m3u8" }
  → Browser conecta DIRETO no nó 2 (HLS.js)

Playback:
  Dashboard (Control) → GET /api/recordings/Y/stream
  → Control pergunta ao nó: "gera pre-signed URL da gravação Y"
  → Retorna: { url: "https://usc1.contabostorage.com/...?sig=..." }
  → Browser conecta DIRETO no S3
```

### DNS (Cloudflare)

Domínio registrado no Registro.br. Nameservers apontados para Cloudflare.
Gerenciamento de registros via Cloudflare API (automático pelo Control).

```
flactech.com.br          → VPS Control   (landing)
www.flactech.com.br      → VPS Control   (landing)
guard.flactech.com.br    → VPS Control   (dashboard cliente)
app.flactech.com.br      → VPS Control   (admin)
api.flactech.com.br      → VPS Control   (gateway)
node-1.flactech.com.br   → Nó 1 IP      (HLS + RTMP + API interna)
node-2.flactech.com.br   → Nó 2 IP      (criado automaticamente)
node-N.flactech.com.br   → Nó N IP      (criado automaticamente)

MX → Google Workspace
SPF → Google + Brevo
DKIM → Google + Brevo
DMARC → quarantine
```

---

## 4. Multi-nó por Tenant

Um tenant pode ter N nós. O Control conhece a tabela `tenant_nodes`.
O cliente não sabe quantos nós tem — vê um dashboard unificado.

### Estratégia de alocação

| Tamanho | Câmeras | Nós | Tipo |
|---------|:-------:|:---:|------|
| Tester (1 PDV) | 3 | 0 | Compartilhado |
| Pequeno (5-10 PDVs) | 15-30 | 1 | Compartilhado/dedicado |
| Médio (15-30 PDVs) | 45-90 | 2-3 | Dedicado |
| Grande (50-100 PDVs) | 150-300 | 4-8 | Dedicado |
| Ultra (200-300 PDVs) | 600-900 | 15-23 | Dedicado |

### Auto-scaling

Nó atinge 85% capacidade → Control provisiona novo VPS 30 via Contabo API → cria DNS via Cloudflare API → SSL via Certbot → registra tenant_nodes → pronto (~3-5 min).

---

## 5. Caso HappyDo (tenant zero)

| Dado | Valor |
|------|:-----:|
| PDVs | 66 |
| Câmeras monitoramento | 89 |
| Câmeras facial (1/PDV grátis) | 65 |
| **Total** | **154** |
| Crescimento 1 ano (+30%) | ~200 |

### Dimensionamento

- CPU necessário: ~25 vCPU → **4 nós VPS 30** (32 vCPU)
- S3 (21 dias): ~1.88 TB → auto-scaling cap 2.5 TB

### Custo

| Item | Custo/mês |
|------|:---------:|
| 4× VPS 30 | $48.00 |
| S3 (~2 TB, 8 slots) | $23.92 |
| Control (rateado) | $0.50 |
| **Total** | **$72.42 (~R$ 400)** |
| **Receita** (89 câm × R$ 49,90) | **R$ 4.441** |
| **Margem** | **91%** |

---

## 6. Planos e Preços

| | **Tester** | **Monitoring** | **Advanced** | **Ultra** |
|---|:---:|:---:|:---:|:---:|
| **Preço/câmera** | Grátis | **R$ 49,90** | **R$ 59,90** | **R$ 44,90** |
| PDVs | 1 | até 30 | até 100 | até 300 |
| Câmeras/PDV | até 2 | até 3 | até 3 | até 3 |
| Facial grátis/PDV | 1 | 1 | 1 | 1 |
| Retenção | 14 dias | 21 dias | 21 dias | 21 dias |
| Duração | 30 dias | Mensal | Mensal | Mensal |

Cobrança por câmera ativa + 1 facial grátis/PDV. Stripe per-unit pricing.

---

## 7. Billing — Stripe

Subscription flow: checkout → webhook → criar tenant → calcular nós → provisionar via Contabo API → DNS via Cloudflare → SSL → email credenciais.

Email: Google Workspace (corporativo) + Brevo SMTP (transacional).

---

## 8. Custos mensais (SaaS rodando)

| Item | Qtd | Custo |
|------|:---:|:-----:|
| VPS 10 (Control) | 1 | $3.96 |
| VPS 30 (nó compartilhado testers) | 1 | $12.00 |
| VPS 30 (nós HappyDo) | 4 | $48.00 |
| S3 HappyDo (~2 TB) | 8 slots | $23.92 |
| S3 testers (~50 GB) | 1 slot | $2.99 |
| Cloudflare | — | Grátis |
| Google Workspace | 1 user | ~$7.00 |
| Brevo | — | Grátis |
| **Total** | | **~$98 (~R$ 540)** |

---

## 9. Status e Próximos Passos

### Concluído ✅

- Fase 2.5A: Multi-tenant + S3 no nó
- VPS 20 + S3 250GB (US-Central)
- 5 câmeras em produção, 51.364 embeddings
- Google Workspace + Brevo configurados

### Fase 2.5B — Implementação (ver Plano de Mudanças)

10 fases: infra → endpoints internos → control API → gateway → dashboard cliente → Stripe → landing → provisioning → email → go-live HappyDo

### Projeção 30.000 PDVs

| Recurso | Custo/mês |
|---------|:---------:|
| ~1.875 nós VPS 30 | ~R$ 124.000 |
| S3 (~750 TB) | ~R$ 50.000 |
| Control (VPS 20) | ~R$ 60 |
| **Total** | **~R$ 174.000** |
| **Receita** (75k câm × R$ 47) | **~R$ 3.525.000** |
| **Margem** | **~95%** |
