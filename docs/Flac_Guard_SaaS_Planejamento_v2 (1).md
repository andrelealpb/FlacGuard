# Flac Guard SaaS — Planejamento Completo (v2)

> Documento de estratégia para transformar o Flac Guard em produto SaaS
> Março 2026 | Atualizado com dados reais de produção
> Domínio: flactech.com.br
> Infra atual: Cloud VPS 20 NVMe (US-Central) + Contabo S3 250GB (US-Central)

---

## 1. Custo de Infraestrutura por Câmera

### Dados reais de produção (5 câmeras, 8 dias)

| Câmera | GB/dia real | Gravações/dia |
|--------|:-----------:|:-------------:|
| Loja Geral (Alta Garden, iM3 C) | 0.68 | ~100 |
| Camera Entrada (Bosque, iM5 SC) | 0.64 | ~96 |
| Camera Fundo (Bosque, iM5 SC) | 0.36 | ~74 |
| Camera Facial (Reinos, iM5 SC) | 0.53 | ~66 |
| Camera Geral (Reinos, iM3 C) | 0.43 | ~51 |
| **Média** | **0.53** | **~77** |
| **Pior caso (para cálculos)** | **0.70** | |

### Storage por câmera (21 dias retenção, 0.7 GB/dia)

- Gravações: **14.7 GB**
- Face embeddings: ~15 MB
- **Total: ~15 GB por câmera**

### Custo detalhado por câmera

| Componente | Custo/câmera/mês | Cálculo |
|-----------|:----------------:|---------|
| Processamento (VPS 30 SSD, $20.50) | R$ 1,62 | R$ 113 ÷ 70 câmeras |
| Storage S3 (21 dias) | R$ 0,90 | 15GB × (€2.49÷250GB) |
| Face embeddings (pgvector) | R$ 0,10 | ~15MB/câm no banco |
| VPS de controle (rateado) | R$ 0,15 | R$ 38 ÷ 250 câmeras |
| **Total infra** | **R$ 2,77** | (70 câmeras/nó) |

### Custo por escala

| Câmeras no nó | Custo infra/câm/mês |
|:-------------:|:-------------------:|
| ~20 (nó pouco ocupado) | R$ 6,80 |
| ~50 | R$ 3,90 |
| ~70 (ótimo) | R$ 2,77 |
| ~150 (nó grande) | R$ 2,15 |

---

## 2. Arquitetura SaaS

```
┌──────────────────────────────────────────────────┐
│        VPS DE CONTROLE (Cloud VPS 10, $6.75)      │
│        flactech.com.br / app.flactech.com.br      │
│                                                    │
│  Landing Page (site comercial + pricing)           │
│  Licensing API (Node.js)                           │
│  ├── Tenants CRUD                                  │
│  ├── Planos e limites                              │
│  ├── Stripe billing (webhooks)                     │
│  ├── Node registry + allocation                    │
│  ├── Node provisioning (Contabo API)               │
│  └── Admin dashboard                               │
│  PostgreSQL (tenants, planos, billing, nodes)       │
│  Email transacional (Resend / Brevo)               │
└──────────────────────────────────────────────────┘
          │                    │
          │ API interna        │ Stripe webhooks
          ▼                    ▼
┌─────────────────┐   ┌─────────────────┐
│  NÓ PROC. #1    │   │  NÓ PROC. #2    │  ...N nós
│  VPS 30 ($20.50) │   │  VPS 30 ($20.50) │
│  US-Central      │   │  US-Central      │
│                 │   │                 │
│  Nginx-RTMP     │   │  Nginx-RTMP     │
│  API (Node.js)  │   │  API (Node.js)  │
│  Face Service   │   │  Face Service   │
│  Dashboard      │   │  Dashboard      │
│  PostgreSQL     │   │  PostgreSQL     │
│                 │   │                 │
│  guard.flactech.com.br              │
│  node-1.guard.flactech.com.br       │
└─────────────────┘   └─────────────────┘
          │                    │
          ▼                    ▼
┌──────────────────────────────────────────────────┐
│    CONTABO S3 (US-Central, auto-scaling + cap)    │
│    FlacGuard-S3 (250GB base, auto-scale até 5TB)  │
│                                                    │
│    recordings/{tenant_id}/{camera_id}/YYYY-MM-DD/  │
│    faces/{tenant_id}/{camera_id}/YYYY-MM-DD/       │
│    watchlist/{tenant_id}/                          │
└──────────────────────────────────────────────────┘
```

### DNS (flactech.com.br)

| Subdomínio | IP | Função |
|-----------|-----|--------|
| flactech.com.br | VPS controle | Landing page |
| app.flactech.com.br | VPS controle | Admin / billing portal |
| guard.flactech.com.br | Nó #1 (147.93.141.133) | Dashboard cliente |
| api-guard.flactech.com.br | Nó #1 | API |
| rtmp-guard.flactech.com.br | Nó #1 | RTMP ingest |
| node-N.guard.flactech.com.br | Nó N | Nós futuros |

### Provisionamento automático de nós

Via Contabo API (REST) + cloud-init:

```
VPS controle detecta nó cheio (>80% capacidade)
  → POST /v1/compute/instances (Contabo API)
  → cloud-init: instala Docker, clona repo, sobe containers
  → Registra nó no banco do controle
  → DNS: cria registro node-N.guard.flactech.com.br
  → Pronto para receber tenants (~2 min após conta verificada)
```

### Object Storage — Auto-scaling

- Bucket: FlacGuard-S3 (US-Central)
- Base: 250 GB (€2.49/mês)
- Auto-scaling: habilitado com cap
- Cap recomendado: 1 TB inicialmente (€9.96/mês máximo)
- Aumentar cap conforme demanda cresce
- Sem necessidade de criar múltiplos storages

### Email

| Serviço | Função | Custo |
|---------|--------|-------|
| **Google Workspace** | Corporativo: leal@, suporte@, contato@flactech.com.br | R$ 28/usuário/mês |
| **Brevo** | Transacional: noreply@flactech.com.br (boas-vindas, faturas, alertas) | Grátis até 300/dia |

Reply-To dos emails transacionais → suporte@flactech.com.br (cai no Gmail).

DNS: MX → Google, SPF inclui Google + Brevo, DKIM ambos, DMARC quarantine.

---

## 3. Planos e Preços

### Referência de mercado

Concorrentes cobram **R$ 49,90 a R$ 69,90 por câmera/mês**.

### Tabela de planos

| | **Tester** | **Monitoring** | **Advanced** | **Ultra** |
|---|:---:|:---:|:---:|:---:|
| **Preço/câmera** | Grátis | **R$ 49,90** | **R$ 59,90** | **R$ 44,90** |
| PDVs | 1 | até 30 | até 100 | até 300 |
| Câmeras/PDV | até 2 | até 3 | até 3 | até 3 |
| Facial grátis/PDV | 1 | 1 | 1 | 1 |
| Retenção | 14 dias | 21 dias | 21 dias | 21 dias |
| Duração | 30 dias | Mensal | Mensal | Mensal |
| Ao Vivo | ✅ | ✅ | ✅ | ✅ |
| Gravações | ✅ | ✅ | ✅ | ✅ |
| Busca facial (upload) | ✅ | ✅ | ✅ | ✅ |
| Watchlist | ✅ | ✅ | ✅ | ✅ |
| Busca suspeito por vídeo | ❌ | ✅ | ✅ | ✅ |
| Contador de visitantes | ❌ | ✅ | ✅ | ✅ |
| Integração ERP | ❌ | ❌ | ✅ | ✅ |
| Suporte | Email | Email + Chat | Prioritário | Dedicado |

### Lógica de preços

- **Monitoring (R$ 49,90):** base de mercado, referência principal
- **Advanced (R$ 59,90):** +R$ 10 pelo repasse a parceiros de integração ERP
- **Ultra (R$ 44,90):** desconto de escala (~10% abaixo do Monitoring)
- **Tester:** conversão, sem custo

### Modelo de cobrança

Cobrança **por câmera ativa (canal de gravação)**, com **1 câmera facial grátis por PDV**.

Exemplo: 10 PDVs × (2 câmeras monitoramento + 1 facial grátis) = **20 câmeras cobradas**.

### Simulação de receita

| Plano | Cenário | Câm cobradas | Receita/mês | Custo infra | Margem |
|-------|---------|:------------:|:-----------:|:-----------:|:------:|
| Tester | 1 PDV, 2+1 câm | 0 | R$ 0 | ~R$ 20 | -100% |
| Monitoring | 15 PDVs, 2+1 câm | 30 | **R$ 1.497** | ~R$ 170 | **89%** |
| Advanced | 50 PDVs, 2+1 câm | 100 | **R$ 5.990** | ~R$ 410 | **93%** |
| Ultra | 200 PDVs, 2+1 câm | 400 | **R$ 17.960** | ~R$ 1.300 | **93%** |

---

## 4. Billing — Stripe

### Por que Stripe

- Suporta BRL + cartão + boleto + Pix
- API de subscriptions (trials, upgrades, downgrades, proration automática)
- Pricing tables embeddable (componente pronto para landing page)
- Customer portal self-service
- Webhooks para automação completa
- Taxa: 3.99% + R$0.39/transação (cartão Brasil)

### Produtos no Stripe

| Produto | Preço (per-unit, mensal) | Stripe Price ID |
|---------|:------------------------:|-----------------|
| Flac Guard Monitoring | R$ 49,90/câmera | price_monitoring_xxx |
| Flac Guard Advanced | R$ 59,90/câmera | price_advanced_xxx |
| Flac Guard Ultra | R$ 44,90/câmera | price_ultra_xxx |

### Subscription flow

```
1. Cliente → flactech.com.br/pricing → escolhe plano
2. Stripe Checkout → cartão/boleto/pix
3. Webhook checkout.session.completed → VPS controle
4. Licensing API:
   a. Cria tenant no banco do controle
   b. Seleciona nó com capacidade
   c. Cria tenant no nó (API interna)
   d. Email: credenciais + instruções
5. Cliente acessa guard.flactech.com.br → configura câmeras
```

### Webhooks Stripe → VPS controle

| Evento | Ação |
|--------|------|
| `checkout.session.completed` | Criar tenant + alocar nó |
| `invoice.paid` | Ativar/renovar |
| `invoice.payment_failed` | Grace period 3 dias → suspender |
| `customer.subscription.updated` | Ajustar limites (up/downgrade) |
| `customer.subscription.deleted` | Desativar tenant, reter dados 30 dias |

### Atualização de quantidade

Quando cliente adiciona câmeras → API do nó conta câmeras → informa controle → Stripe atualiza subscription (proration automática pro próximo ciclo).

---

## 5. Projeção de Escala

### Cenário: 30.000 PDVs, média 2.5 câm/PDV = 75.000 câmeras

| Recurso | Quantidade | Custo/mês |
|---------|:----------:|:---------:|
| Nós processamento (VPS 30) | ~1.100 | ~R$ 124.000 |
| S3 auto-scaling (~750 TB) | ~3.000 slots | ~R$ 45.000 |
| VPS controle (VPS 20) | 1 | ~R$ 60 |
| Email transacional (SES) | ~50k emails | ~R$ 30 |
| **Total infra** | | **~R$ 169.000/mês** |
| **Receita** (75k × R$ 47 médio) | | **~R$ 3.525.000/mês** |
| **Margem** | | **~95%** |

Provisionamento de nós via Contabo API: automatizado, ~2 min por nó.

---

## 6. Status e Próximos Passos

### Feito ✅

- Stack Docker Compose (5 containers)
- Face recognition (InsightFace + YOLO26n, two-pass detection)
- Dashboard React + auth JWT
- Deploy automático (GitHub webhook)
- Upgrade VPS 20 NVMe (US-Central, 6 cores, 12GB, 100GB NVMe)
- Contabo S3 250GB (US-Central, mesma região, auto-scaling disponível)
- Domínio flactech.com.br + DNS configurado (guard, api-guard, rtmp-guard, hls-guard)
- Google Workspace (email corporativo @flactech.com.br)
- Brevo (email transacional noreply@flactech.com.br)

### Fase 2.5A — Multi-tenant + S3 ✅ CONCLUÍDA (branch claude/implement-scaling-plan)

1. ✅ Migration 007: s3_key em recordings
2. ✅ Migration 008: tenant_id em todas tabelas + tenant 'happydo' criado
3. ✅ services/storage.js (upload/download S3 com @aws-sdk/client-s3)
4. ✅ services/tenant.js (isolamento por tenant_id)
5. ✅ Recorder: upload S3 após gravação
6. ✅ Playback: pre-signed URL para S3 + fallback local
7. ✅ Cleanup: deleta do S3 e do local
8. ✅ Todas routes filtram por tenant_id
9. ✅ Auth: tenant_id no JWT
10. ✅ Fix: PDVs sync UPDATE filtra por tenant_id (bug de segurança corrigido)
11. ✅ Dashboard: card de monitoramento S3
12. ✅ Migração batch de gravações locais → S3
13. ✅ Face detection compatível com gravações S3
14. ✅ Fix: porcentagens Docker no painel de disco
15. ✅ Fix: contagem de arquivos de gravação consistente
16. ✅ Subdomínios configurados (guard, api-guard, rtmp-guard, hls-guard)
17. ✅ Docs: SETUP_S3_CONTABO.md + MIGRACAO_NOVO_SERVIDOR.md

### Pendências (não bloqueiam SaaS, implementar conforme necessidade)

- UI de gestão de tenants (CRUD no dashboard — quando houver 2+ clientes)
- CRUD de API Keys (tabela existe, endpoints não)
- Endpoints snapshot e download de clipes (cameras.js retornam 501)
- Migração Contabo S3 → Backblaze B2 + Cloudflare CDN (quando escalar playback)

### Fase 2.5B — VPS de controle ⏳ PRÓXIMA

1. Provisionar Cloud VPS 10 ($6.75)
2. Criar repo `flac-guard-control`
3. Licensing API
4. Stripe integration
5. Landing page + pricing table
6. Admin dashboard
7. Email transacional (Resend)
8. Node provisioning (Contabo API)

### Fase 2.5C — Go-to-market

1. SSL para controle + nós
2. Documentação para cliente
3. Email templates (boas-vindas, fatura, trial)
4. Primeiro cliente teste externo
