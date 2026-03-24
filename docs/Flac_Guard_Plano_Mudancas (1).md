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

### Depois
- VPS de Control (VPS 10, leve) → serve dashboard React + API gateway JSON
- N nós de processamento (VPS 30) → recebem RTMP, gravam, processam facial
- Vídeo (live e playback) vai direto do browser para o nó/S3, sem passar pelo Control
- Control consolida dados JSON de todos os nós de forma transparente
- Cliente não sabe que existem múltiplos nós

### Por que o vídeo não passa pelo Control?
- HLS live: ~1 Mbps por câmera assistida. 40 streams = 40 Mbps constante
- VPS 10 tem 200 Mbit/s, ficaria saturado
- Browser conecta direto no nó (HLS) ou no S3 (playback) = zero carga de vídeo no Control
- Control só trafega JSON (listas, configs, resultados de busca) = ~5-20 Mbit/s

---

## 2. DNS — Plano completo (Registro.br)

### DNS atual (tudo aponta pro VPS 20 atual: 147.93.141.133)

```
A   api-guard.flactech.com.br      147.93.141.133
A   deploy-guard.flactech.com.br   147.93.141.133
A   guard.flactech.com.br          147.93.141.133
A   hls-guard.flactech.com.br      147.93.141.133
A   rtmp-guard.flactech.com.br     147.93.141.133
A   ssh-guard.flactech.com.br      147.93.141.133
```

### DNS novo (após provisionar Control + nós)

**Premissa:** 
- IP do VPS Control (VPS 10): a ser definido após provisionar, ex: `AAA.BBB.CCC.DDD`
- IP do Nó 1 (VPS 30, migração do VPS 20 atual): `147.93.141.133` (ou novo IP após upgrade)
- IPs dos Nós 2, 3, 4: definidos após provisionamento

#### Registros a ALTERAR no Registro.br

```
# ========================================
# CONTROL (VPS 10 — novo)
# ========================================

# Landing page (site comercial)
A   flactech.com.br                 AAA.BBB.CCC.DDD    ← NOVO
A   www.flactech.com.br             AAA.BBB.CCC.DDD    ← NOVO

# Dashboard do cliente (React SPA servido pelo Control)
A   guard.flactech.com.br           AAA.BBB.CCC.DDD    ← ALTERAR (antes: 147.93.141.133)

# Dashboard admin
A   app.flactech.com.br             AAA.BBB.CCC.DDD    ← NOVO

# API do Control (gateway)
A   api.flactech.com.br             AAA.BBB.CCC.DDD    ← NOVO


# ========================================
# NÓS DE PROCESSAMENTO
# ========================================

# Nó 1 (VPS 30 — upgrade/migração do VPS 20 atual)
A   node-1.flactech.com.br          147.93.141.133      ← NOVO (ou novo IP)
# HLS live e RTMP ficam no nó, browser acessa direto
# Cada nó precisa de HTTPS para o browser aceitar conexão HLS

# Nó 2 (VPS 30 — novo, provisionado via Contabo API)
A   node-2.flactech.com.br          [IP do nó 2]        ← NOVO

# Nó 3
A   node-3.flactech.com.br          [IP do nó 3]        ← NOVO

# Nó 4
A   node-4.flactech.com.br          [IP do nó 4]        ← NOVO

# Padrão para nós futuros: node-N.flactech.com.br


# ========================================
# REMOVER (não serão mais usados)
# ========================================

# Estes apontavam pro VPS antigo e serão substituídos
# REMOVER   api-guard.flactech.com.br     (substituído por api.flactech.com.br)
# REMOVER   hls-guard.flactech.com.br     (HLS agora via node-N.flactech.com.br)
# REMOVER   rtmp-guard.flactech.com.br    (RTMP agora via node-N.flactech.com.br)
# REMOVER   deploy-guard.flactech.com.br  (deploy webhook agora no nó)
# REMOVER   ssh-guard.flactech.com.br     (SSH direto por IP ou node-N)


# ========================================
# EMAIL (Google Workspace + Brevo)
# ========================================

# MX records (receber email via Google)
MX  flactech.com.br   ASPMX.L.GOOGLE.COM           prioridade 1
MX  flactech.com.br   ALT1.ASPMX.L.GOOGLE.COM      prioridade 5
MX  flactech.com.br   ALT2.ASPMX.L.GOOGLE.COM      prioridade 5
MX  flactech.com.br   ALT3.ASPMX.L.GOOGLE.COM      prioridade 10
MX  flactech.com.br   ALT4.ASPMX.L.GOOGLE.COM      prioridade 10

# SPF (quem pode enviar email pelo domínio)
TXT flactech.com.br   "v=spf1 include:_spf.google.com include:sendinblue.com ~all"

# DKIM Google (valor fornecido pelo Google Admin Console)
TXT google._domainkey.flactech.com.br   "v=DKIM1; k=rsa; p=..."

# DKIM Brevo (valor fornecido pelo painel Brevo)
TXT mail._domainkey.flactech.com.br     "v=DKIM1; k=rsa; p=..."

# DMARC
TXT _dmarc.flactech.com.br             "v=DMARC1; p=quarantine; rua=mailto:leal@flactech.com.br"

# Verificação Google Workspace
TXT flactech.com.br   "google-site-verification=..."

# Verificação Brevo
TXT flactech.com.br   "brevo-code:xxxxxxxxxxxx"
```

#### Resumo visual

```
flactech.com.br          → Control (landing page)
www.flactech.com.br      → Control (landing page)
guard.flactech.com.br    → Control (dashboard cliente)
app.flactech.com.br      → Control (dashboard admin)
api.flactech.com.br      → Control (API gateway)
node-1.flactech.com.br   → Nó 1 (HLS + RTMP + API interna)
node-2.flactech.com.br   → Nó 2
node-3.flactech.com.br   → Nó 3
node-N.flactech.com.br   → Nó N
```

### Automação de DNS para nós novos

Quando o Control provisiona um novo nó via Contabo API, ele precisa criar o registro DNS `node-N.flactech.com.br`. Opções:

1. **Cloudflare como DNS** (recomendado): API Cloudflare permite criar registros A programaticamente. Migrar nameservers do Registro.br para Cloudflare (grátis). Então o Control cria `node-N.flactech.com.br` via API automaticamente.

2. **Registro.br manual**: não tem API. Cada nó novo precisaria de intervenção manual no painel do Registro.br. Não escala.

3. **Wildcard DNS**: criar `*.flactech.com.br → IP` não funciona porque cada nó tem IP diferente.

**Recomendação forte: migrar DNS para Cloudflare.** Mantém o domínio no Registro.br (registro), mas os nameservers apontam para Cloudflare (resolução). Cloudflare é grátis, tem API REST, e ainda dá SSL automático e CDN se quiser no futuro.

---

## 3. O que muda no NÓ (repo FlacGuard)

### Mudanças necessárias

| Item | Descrição | Impacto |
|------|-----------|---------|
| **Remover dashboard** | Nó não serve mais dashboard pro cliente. O container `dashboard` pode ser removido do docker-compose do nó | Médio |
| **Adicionar endpoints internos** | `routes/internal.js` com auth X-Internal-Key | Alto |
| **HTTPS no nó** | Browser precisa de HTTPS para acessar HLS direto. Certbot + Nginx no host do nó | Médio |
| **CORS configurável** | Nó precisa aceitar requests de `guard.flactech.com.br` (o dashboard do Control) | Baixo |
| **HLS via HTTPS** | Nginx do host faz proxy para porta 8080 com SSL | Médio |

### Endpoints internos a criar (routes/internal.js)

```
# Chamados pelo Control (auth: X-Internal-Key)
POST   /api/internal/tenants                    # Criar tenant no nó
DELETE /api/internal/tenants/:id                 # Desativar tenant
PUT    /api/internal/tenants/:id/limits          # Atualizar plano/limites

# Chamados pelo Control Gateway (auth: X-Internal-Key + X-Tenant-Id)
GET    /api/internal/cameras                     # Listar câmeras do tenant
POST   /api/internal/cameras                     # Criar câmera
PUT    /api/internal/cameras/:id                 # Atualizar câmera
DELETE /api/internal/cameras/:id                 # Remover câmera
GET    /api/internal/cameras/:id/live            # URL HLS (IP do nó)

GET    /api/internal/recordings                  # Listar gravações do tenant
GET    /api/internal/recordings/by-day           # Timeline
GET    /api/internal/recordings/:id/stream       # Pre-signed URL do S3

POST   /api/internal/faces/search               # Busca facial no pgvector local
GET    /api/internal/faces/watchlist             # Watchlist do tenant
POST   /api/internal/faces/watchlist             # Criar item watchlist
DELETE /api/internal/faces/watchlist/:id         # Remover
GET    /api/internal/faces/visitors              # Visitantes
GET    /api/internal/faces/alerts                # Alertas watchlist

GET    /api/internal/pdvs                        # PDVs do tenant
POST   /api/internal/pdvs/sync                   # Sync Pulse
GET    /api/internal/events                      # Eventos
GET    /api/internal/monitor/system              # Stats do nó

POST   /api/internal/usage                       # Reportar uso ao Control
```

Esses endpoints são essencialmente os mesmos endpoints que já existem (ex: `routes/cameras.js`, `routes/recordings.js`), mas:
- Auth é por `X-Internal-Key` (não JWT de usuário)
- Tenant é identificado por `X-Tenant-Id` (não extraído do JWT)
- Respostas não incluem HTML, apenas JSON

**Estratégia de implementação:** criar `routes/internal.js` que reutiliza a lógica existente dos services, mas com auth diferente. Não duplicar código — chamar os mesmos services (recording.js, face-recognition.js, etc).

### Docker-compose do nó (após mudança)

```yaml
services:
  nginx-rtmp      # Porta 1935 (RTMP) + 8080 (HLS)
  api             # Porta 8000 (API interna + endpoints internos)
  face-service    # Porta 8001 (InsightFace + YOLO)
  db              # PostgreSQL 16 + pgvector
  # dashboard REMOVIDO — cliente acessa via Control
```

### Nginx no host do nó (HTTPS para HLS)

```nginx
server {
    listen 443 ssl;
    server_name node-1.flactech.com.br;
    ssl_certificate /etc/letsencrypt/live/node-1.flactech.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/node-1.flactech.com.br/privkey.pem;

    # HLS — browser acessa direto
    location /hls/ {
        proxy_pass http://localhost:8080/hls/;
        add_header Access-Control-Allow-Origin "https://guard.flactech.com.br";
        add_header Access-Control-Allow-Methods "GET, OPTIONS";
    }

    # API interna — só o Control acessa
    location /api/internal/ {
        proxy_pass http://localhost:8000/api/internal/;
        # Restringir por IP do Control se quiser segurança extra
    }

    # Bloquear acesso direto ao dashboard (não existe mais no nó)
    location / {
        return 404;
    }
}
```

---

## 4. O que muda no CONTROL (repo flac-guard-control)

### Papel do Control

```
┌──────────────────────────────────────────────┐
│                 CONTROL                       │
│                                               │
│  [Landing]  [Dashboard Cliente]  [Admin]      │
│      ↓              ↓               ↓         │
│  Stripe         Gateway API      Admin API    │
│  Billing     (proxy JSON → nós)  (tenants,    │
│                     │            nodes,        │
│                     │            billing)      │
│                     ▼                          │
│           ┌─────────────────┐                 │
│           │  Consulta todos  │                 │
│           │  os nós do       │                 │
│           │  tenant em       │                 │
│           │  paralelo        │                 │
│           └─────────────────┘                 │
│                     │                          │
│           Retorna JSON consolidado             │
│           + URLs diretas dos nós (HLS/S3)      │
└──────────────────────────────────────────────┘
```

### Fluxo detalhado por funcionalidade

#### Live (ao vivo)

```
1. Dashboard React (no Control) lista câmeras:
   GET /api/cameras → Control consulta nós 1,2,3,4 → merge → retorna lista

2. Usuário clica play na câmera X:
   GET /api/cameras/X/live
   → Control busca no camera_node_map: câmera X está no nó 2
   → Control pede ao nó 2: GET /api/internal/cameras/X/live
   → Nó 2 retorna: { hls_url: "/hls/happydo_abc123.m3u8" }
   → Control monta URL completa: "https://node-2.flactech.com.br/hls/happydo_abc123.m3u8"
   → Retorna ao browser

3. HLS.js no browser conecta DIRETO em node-2.flactech.com.br
   → Tráfego de vídeo: Browser ↔ Nó 2 (Control não participa)
```

#### Playback (gravações)

```
1. Dashboard lista gravações de um dia:
   GET /api/recordings/by-day?date=2026-03-24&camera_id=X
   → Control sabe que câmera X está no nó 2
   → Consulta nó 2: GET /api/internal/recordings/by-day?...
   → Retorna lista de gravações (JSON)

2. Usuário clica play na gravação Y:
   GET /api/recordings/Y/stream
   → Control pede ao nó 2: GET /api/internal/recordings/Y/stream
   → Nó 2 gera pre-signed URL do S3
   → Retorna: { url: "https://usc1.contabostorage.com/...?X-Amz-Signature=..." }
   → Browser conecta DIRETO no S3

3. Tráfego de vídeo: Browser ↔ Contabo S3 (Control não participa)
```

#### Busca facial

```
1. Usuário faz upload de foto:
   POST /api/faces/search { image: base64 }
   → Control distribui para TODOS os nós do tenant em paralelo:
     POST node-1/api/internal/faces/search { image }
     POST node-2/api/internal/faces/search { image }
     POST node-3/api/internal/faces/search { image }
     POST node-4/api/internal/faces/search { image }
   → Cada nó busca no seu pgvector local
   → Control recebe 4 listas de resultados
   → Merge por similarity score (descendente)
   → Retorna lista unificada ao browser
```

#### Cadastro de câmera

```
1. Usuário clica "+ Nova Câmera":
   POST /api/cameras { name, pdv_id, model, ... }
   → Control verifica limites do plano
   → Seleciona nó com mais capacidade livre (tenant_nodes)
   → Se todos cheios → provisiona novo VPS 30 via Contabo API
   → Cria câmera no nó selecionado: POST node-N/api/internal/cameras
   → Registra em camera_node_map
   → Retorna câmera criada + stream key + endereço RTMP do nó
     { rtmp_url: "rtmp://node-2.flactech.com.br:1935/live/happydo_xyz" }
```

#### Watchlist

```
1. Usuário adiciona pessoa à watchlist:
   POST /api/faces/watchlist { name, photo }
   → Control distribui para TODOS os nós do tenant:
     POST node-1/api/internal/faces/watchlist { name, photo }
     POST node-2/api/internal/faces/watchlist { name, photo }
     ...
   → Watchlist replicada em todos os nós
   → Qualquer nó que detectar match → gera alerta
```

---

## 5. Dashboard do Cliente (no Control)

O dashboard React do cliente é uma **cópia adaptada** do dashboard atual do FlacGuard, com estas diferenças:

| Aspecto | Dashboard atual (nó) | Dashboard novo (Control) |
|---------|---------------------|--------------------------|
| API base | `http://localhost:8000/api` | `https://guard.flactech.com.br/api` |
| HLS URL | Relativa (`/hls/key.m3u8`) | Absoluta (`https://node-N.flactech.com.br/hls/key.m3u8`) |
| Playback | Relativa | Pre-signed URL do S3 |
| Auth | JWT do nó | JWT do Control (com tenant_id) |
| Câmeras | Direto do banco local | Consolidado de N nós |
| Monitoring | Stats do VPS local | Stats consolidados de N nós |

**Na prática:** clonar o dashboard, trocar as chamadas de API para usar o gateway, e ajustar o HLS player para aceitar URLs absolutas. A UX para o cliente é idêntica.

---

## 6. HTTPS / SSL nos nós

Cada nó precisa de HTTPS porque browsers modernos bloqueiam conteúdo misto (dashboard HTTPS + HLS HTTP = bloqueado).

### Opção A: Certbot por nó (recomendada para agora)

```bash
# Em cada nó, após provisionar:
apt install -y certbot python3-certbot-nginx
certbot --nginx -d node-N.flactech.com.br --non-interactive --agree-tos -m leal@flactech.com.br
```

Pode ser incluído no cloud-init do Contabo API. O DNS precisa estar propagado antes.

### Opção B: Cloudflare Proxy (futuro)

Se migrar DNS para Cloudflare, o SSL é automático e gratuito pelo proxy Cloudflare. Nenhum Certbot necessário nos nós.

---

## 7. Migração Cloudflare (DNS)

### Por que migrar do Registro.br para Cloudflare?

| Aspecto | Registro.br | Cloudflare |
|---------|:-----------:|:----------:|
| API para criar registros | ❌ Não tem | ✅ REST API |
| SSL automático | ❌ | ✅ (proxy) |
| Criar node-N.flactech.com.br via código | ❌ Manual | ✅ Automático |
| Custo | Grátis | Grátis |
| CDN | ❌ | ✅ (opcional) |
| DDoS protection | ❌ | ✅ |

### Passos para migrar

1. Criar conta Cloudflare (grátis) em cloudflare.com
2. Adicionar domínio flactech.com.br
3. Cloudflare importa automaticamente todos os registros DNS atuais
4. Verificar que todos os registros foram importados
5. No Registro.br → Alterar DNS → trocar nameservers para os do Cloudflare:
   - `ns1.cloudflare.com` (ex: `ada.ns.cloudflare.com`)
   - `ns2.cloudflare.com` (ex: `bob.ns.cloudflare.com`)
6. Aguardar propagação (até 24h, geralmente 1-2h)
7. No Cloudflare: configurar registros conforme seção 2 deste documento
8. Anotar API Token do Cloudflare (para o Control criar registros via API)

### Provisionamento automático de DNS (Control → Cloudflare API)

```javascript
// services/cloudflare.js
const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID; // zona do flactech.com.br

export async function createNodeDNS(nodeName, ipAddress) {
  // Cria: node-N.flactech.com.br → IP
  const res = await fetch(`${CF_API}/zones/${CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'A',
      name: `${nodeName}.flactech.com.br`,
      content: ipAddress,
      ttl: 300,
      proxied: false, // Direto, sem proxy CF (RTMP não funciona com proxy)
    }),
  });
  return res.json();
}

export async function deleteNodeDNS(nodeName) {
  // Busca o record ID
  const search = await fetch(
    `${CF_API}/zones/${CF_ZONE_ID}/dns_records?name=${nodeName}.flactech.com.br`,
    { headers: { 'Authorization': `Bearer ${CF_TOKEN}` } }
  );
  const { result } = await search.json();
  if (result.length === 0) return;

  // Deleta
  await fetch(`${CF_API}/zones/${CF_ZONE_ID}/dns_records/${result[0].id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}` },
  });
}
```

---

## 8. Fluxo completo de provisionamento de novo nó

```
1. Control detecta que tenant precisa de mais capacidade
   (câmeras > 85% dos slots alocados)

2. Provisionar VPS via Contabo API
   POST /v1/compute/instances
   → productId: VPS 30 NVMe
   → region: US-central
   → cloud-init: Docker + git clone FlacGuard + docker compose up
   → Retorna: instanceId + IP

3. Criar DNS via Cloudflare API
   POST node-N.flactech.com.br → IP do novo VPS
   → Aguardar propagação (~30s no Cloudflare)

4. Instalar SSL via cloud-init ou SSH
   certbot --nginx -d node-N.flactech.com.br

5. Registrar nó no banco do Control
   INSERT INTO nodes (host: 'node-N.flactech.com.br', ...)
   INSERT INTO tenant_nodes (tenant_id, node_id, camera_slots: 40)

6. Health check
   GET https://node-N.flactech.com.br/api/internal/health
   → Quando responder OK → status = 'active'

7. Pronto para receber câmeras
   Tempo total: ~3-5 minutos
```

---

## 9. Ordem de implementação (passo a passo)

### Fase 1: Preparar infraestrutura (manual, ~2h)

```
1.1  Provisionar VPS 10 no Contabo (Control) → anotar IP
1.2  Criar conta Cloudflare → adicionar flactech.com.br
1.3  No Registro.br: trocar nameservers para Cloudflare
1.4  Aguardar propagação DNS
1.5  No Cloudflare: criar todos os registros (seção 2)
1.6  No VPS Control: instalar Docker, Nginx, Certbot
1.7  SSL: certbot para flactech.com.br, guard.flactech.com.br, 
     app.flactech.com.br, api.flactech.com.br
1.8  No VPS nó 1 (atual): certbot para node-1.flactech.com.br
```

### Fase 2: Endpoints internos no nó (Claude Code, repo FlacGuard, ~3h)

```
2.1  Criar routes/internal.js (auth X-Internal-Key)
2.2  Endpoints de tenant management (criar, deletar, limites)
2.3  Endpoints proxy (cameras, recordings, faces, pdvs, events, monitor)
2.4  Configurar CORS para guard.flactech.com.br
2.5  Nginx no host: HTTPS para HLS + API interna
2.6  Remover container dashboard do docker-compose (ou manter opcional)
2.7  Deploy no nó 1 → testar endpoints internos
```

### Fase 3: Control — API base (Claude Code, repo flac-guard-control, ~4h)

```
3.1  Scaffold repo: docker-compose, schema, migrations
3.2  Auth admin (login, JWT)
3.3  CRUD plans, nodes, tenants
3.4  Tabela tenant_nodes + camera_node_map
3.5  Seed: planos (tester, monitoring, advanced, ultra)
3.6  Seed: nó 1 (node-1.flactech.com.br, 147.93.141.133)
3.7  Seed: tenant happydo + tenant_nodes
3.8  Deploy no Control → testar admin API
```

### Fase 4: Control — Gateway multi-nó (Claude Code, ~6h)

```
4.1  services/gateway.js (queryAllNodes, merge, proxy, findCameraNode)
4.2  gateway-auth.js (login do cliente, JWT com tenant_id)
4.3  gateway-cameras.js (GET consolidado, POST com seleção de nó)
4.4  gateway-cameras.js live (retorna URL HTTPS do nó)
4.5  gateway-recordings.js (lista consolidada, stream via pre-signed URL)
4.6  gateway-faces.js (search distribuído, watchlist replicada)
4.7  gateway-pdvs.js, gateway-events.js, gateway-monitor.js
4.8  Testar com nó 1: gateway → nó → JSON consolidado
```

### Fase 5: Dashboard cliente (Claude Code, ~4h)

```
5.1  Clonar/adaptar dashboard do FlacGuard para client-dashboard/
5.2  Trocar API base para gateway do Control
5.3  Ajustar HLS player para URLs absolutas (node-N.flactech.com.br)
5.4  Ajustar playback para pre-signed URLs do S3
5.5  Login com gateway-auth
5.6  Deploy no Control → testar live, playback, cameras, faces
```

### Fase 6: Stripe billing (Claude Code, ~4h)

```
6.1  Criar products + prices no Stripe Dashboard
6.2  services/stripe.js (checkout, webhooks, portal)
6.3  routes/billing.js
6.4  Webhook flow: checkout → criar tenant → alocar nós
6.5  Testar ciclo completo
```

### Fase 7: Landing page + pricing (Claude Code, ~2h)

```
7.1  index.html (site comercial flactech.com.br)
7.2  pricing.html (Stripe Pricing Table)
7.3  Deploy no Control
```

### Fase 8: Provisioning automático (Claude Code, ~4h)

```
8.1  services/contabo.js (Contabo API: criar VPS, cloud-init)
8.2  services/cloudflare.js (criar/deletar DNS A records)
8.3  services/provisioning.js (orquestrar: VPS + DNS + SSL + registro)
8.4  Auto-scaling: monitor 85% → provisionar
8.5  Admin dashboard: nodes com uso, saúde, provisionar manual
```

### Fase 9: Email (manual + Claude Code, ~2h)

```
9.1  Google Workspace: contas leal@, suporte@, contato@
9.2  Brevo: configurar domínio, DKIM
9.3  Cloudflare: MX + SPF + DKIM + DMARC
9.4  services/email.js (nodemailer + Brevo SMTP)
9.5  Templates + integração com webhooks Stripe
```

### Fase 10: HappyDo go-live (manual + Claude Code, ~3h)

```
10.1  Upgrade VPS 20 atual → VPS 30 (ou manter e contar como nó 1)
10.2  Provisionar 3 VPS 30 adicionais (nós 2, 3, 4)
10.3  DNS: node-2, node-3, node-4.flactech.com.br
10.4  SSL nos 3 novos nós
10.5  Distribuir 154 câmeras do HappyDo nos 4 nós (~39 por nó)
10.6  Habilitar auto-scaling S3 com cap 2.5 TB
10.7  Testar dashboard unificado com 4 nós
10.8  Monitorar 48h → ajustar se necessário
```

---

## 10. Resumo de custos pós-implementação

### Infra mensal (SaaS rodando)

| Item | Qtd | Custo/mês |
|------|:---:|:---------:|
| VPS 10 (Control) | 1 | $3.96 |
| VPS 30 (Nó compartilhado testers) | 1 | $12.00 |
| VPS 30 (Nós HappyDo) | 4 | $48.00 |
| S3 HappyDo (~2 TB) | 8 slots | $23.92 |
| S3 Testers (~50 GB) | 1 slot | $2.99 |
| Cloudflare | — | Grátis |
| Google Workspace | 1 user | ~$7.00 |
| Brevo | — | Grátis |
| **Total** | | **$97.87 (~R$ 540/mês)** |

### Receita HappyDo

89 câmeras cobradas × R$ 49,90 = **R$ 4.441/mês**

### Margem

R$ 4.441 - R$ 540 = **R$ 3.901/mês (88% margem)**
