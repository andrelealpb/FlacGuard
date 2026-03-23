# flac-guard-control — Documento Técnico

> Repositório: `github.com/andrelealpb/flac-guard-control`
> VPS: Cloud VPS 10 Contabo ($6.75/mês, 4 cores, 8GB, 75GB NVMe, US-Central)
> Domínio: flactech.com.br
> Função: Licensing, billing, node management, landing page, admin dashboard

---

## 1. Visão Geral

O VPS de controle é o "cérebro" do SaaS. Ele:

- Hospeda o site comercial (landing page + pricing)
- Gerencia tenants (clientes SaaS)
- Integra com Stripe para billing
- Aloca tenants em nós de processamento
- Provisiona novos nós via Contabo API
- Monitora saúde dos nós
- Envia emails transacionais
- Dashboard admin para o operador (Leal)

**Não processa vídeo.** Não roda Nginx-RTMP, Face Service, nem gravação.

### Pré-requisitos concluídos (Fase 2.5A) ✅

O nó de processamento #1 (147.93.141.133) já está preparado para multi-tenant:

- ✅ Multi-tenant implementado (tenant_id em todas tabelas, filtro em todas routes)
- ✅ Object Storage S3 funcionando (upload, playback via pre-signed URL, cleanup)
- ✅ Tenant 'happydo' criado como default (dados existentes migrados)
- ✅ Auth com tenant_id no JWT
- ✅ Subdomínios: guard.flactech.com.br, api-guard, rtmp-guard, hls-guard
- ✅ Face detection + gravações compatíveis com S3
- ✅ Migração batch de gravações locais → S3 executada

**O nó está pronto para receber tenants criados pelo VPS de controle.**

---

## 2. Stack

| Componente | Tecnologia |
|-----------|-----------|
| API | Node.js 20 + Express (ESM) |
| Banco | PostgreSQL 16 |
| Landing page | HTML/CSS/JS estático (ou React build) |
| Admin dashboard | React 18 + TypeScript + Vite |
| Billing | Stripe SDK (stripe npm) |
| Email corporativo | Google Workspace | @flactech.com.br (leal@, suporte@, contato@) |
| Email transacional | Brevo (SMTP relay) + nodemailer | noreply@flactech.com.br, 300/dia grátis |
| Node provisioning | Contabo API (REST) |
| Proxy/SSL | Nginx + Let's Encrypt (certbot) |
| Containers | Docker Compose |

---

## 3. Docker Compose

```yaml
name: flac-guard-control

services:
  api:
    build: ./server
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://flac_control:flac_control@db:5432/flac_control
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - BREVO_SMTP_HOST=${BREVO_SMTP_HOST:-smtp-relay.brevo.com}
      - BREVO_SMTP_PORT=${BREVO_SMTP_PORT:-587}
      - BREVO_SMTP_USER=${BREVO_SMTP_USER}
      - BREVO_SMTP_PASS=${BREVO_SMTP_PASS}
      - EMAIL_FROM=${EMAIL_FROM:-noreply@flactech.com.br}
      - EMAIL_REPLY_TO=${EMAIL_REPLY_TO:-suporte@flactech.com.br}
      - CONTABO_API_CLIENT_ID=${CONTABO_API_CLIENT_ID}
      - CONTABO_API_CLIENT_SECRET=${CONTABO_API_CLIENT_SECRET}
      - CONTABO_API_USER=${CONTABO_API_USER}
      - CONTABO_API_PASSWORD=${CONTABO_API_PASSWORD}
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  dashboard:
    build: ./dashboard-admin
    ports:
      - "3000:3000"
    depends_on:
      - api
    restart: unless-stopped

  landing:
    build: ./landing
    ports:
      - "3001:80"
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=flac_control
      - POSTGRES_PASSWORD=flac_control
      - POSTGRES_DB=flac_control
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flac_control"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

### Nginx reverse proxy (host-level, fora do Docker)

```nginx
# /etc/nginx/sites-available/flactech

# Landing page
server {
    listen 443 ssl;
    server_name flactech.com.br www.flactech.com.br;
    ssl_certificate /etc/letsencrypt/live/flactech.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flactech.com.br/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
    }
    location /api/ {
        proxy_pass http://localhost:8000;
    }
    location /stripe-webhook {
        proxy_pass http://localhost:8000/api/billing/webhook;
    }
}

# Admin dashboard
server {
    listen 443 ssl;
    server_name app.flactech.com.br;
    ssl_certificate /etc/letsencrypt/live/flactech.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flactech.com.br/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
    }
    location /api/ {
        proxy_pass http://localhost:8000;
    }
}
```

---

## 4. Variáveis de Ambiente

```bash
# .env
DATABASE_URL=postgresql://flac_control:flac_control@db:5432/flac_control
JWT_SECRET=change-me-random-secret

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Email transacional (Brevo SMTP)
BREVO_API_KEY=${BREVO_API_KEY}
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=${BREVO_SMTP_USER}
BREVO_SMTP_PASS=${BREVO_SMTP_PASS}
EMAIL_FROM=noreply@flactech.com.br
EMAIL_REPLY_TO=suporte@flactech.com.br

# Contabo API (provisionamento de nós)
CONTABO_API_CLIENT_ID=xxx
CONTABO_API_CLIENT_SECRET=xxx
CONTABO_API_USER=xxx
CONTABO_API_PASSWORD=xxx

# Nó padrão (primeiro nó, já existente)
DEFAULT_NODE_HOST=147.93.141.133
DEFAULT_NODE_API_KEY=xxx
```

---

## 5. Schema do Banco

```sql
-- flac-guard-control schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Planos
CREATE TABLE plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              VARCHAR(50)  NOT NULL UNIQUE,
  display_name      VARCHAR(100) NOT NULL,
  max_pdvs          INTEGER      NOT NULL,
  max_cameras_per_pdv INTEGER    NOT NULL DEFAULT 3,
  free_facial_per_pdv INTEGER    NOT NULL DEFAULT 1,
  retention_days    INTEGER      NOT NULL DEFAULT 21,
  has_video_search  BOOLEAN      NOT NULL DEFAULT false,
  has_visitors      BOOLEAN      NOT NULL DEFAULT false,
  has_erp_integration BOOLEAN    NOT NULL DEFAULT false,
  price_per_camera_brl NUMERIC(8,2) NOT NULL DEFAULT 0,
  trial_days        INTEGER      NOT NULL DEFAULT 0,
  stripe_product_id VARCHAR(100),
  stripe_price_id   VARCHAR(100),
  is_active         BOOLEAN      NOT NULL DEFAULT true,
  sort_order        INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Seed planos
INSERT INTO plans (name, display_name, max_pdvs, max_cameras_per_pdv, retention_days,
  has_video_search, has_visitors, has_erp_integration,
  price_per_camera_brl, trial_days, sort_order)
VALUES
  ('tester',     'Tester',     1,   2,  14, false, false, false, 0,     30, 1),
  ('monitoring', 'Monitoring', 30,  3,  21, true,  true,  false, 49.90, 0,  2),
  ('advanced',   'Advanced',   100, 3,  21, true,  true,  true,  59.90, 0,  3),
  ('ultra',      'Ultra',      300, 3,  21, true,  true,  true,  44.90, 0,  4);

-- Nós de processamento
CREATE TABLE nodes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              VARCHAR(100) NOT NULL,
  host              VARCHAR(255) NOT NULL,
  rtmp_port         INTEGER      NOT NULL DEFAULT 1935,
  api_port          INTEGER      NOT NULL DEFAULT 8000,
  dashboard_port    INTEGER      NOT NULL DEFAULT 3000,
  api_key           VARCHAR(100) NOT NULL,
  max_cameras       INTEGER      NOT NULL DEFAULT 80,
  current_cameras   INTEGER      NOT NULL DEFAULT 0,
  region            VARCHAR(50)  NOT NULL DEFAULT 'us-central',
  contabo_instance_id VARCHAR(100),
  status            VARCHAR(20)  NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'provisioning', 'maintenance', 'retired')),
  last_health_at    TIMESTAMPTZ,
  health_data       JSONB        DEFAULT '{}',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Tenants (clientes SaaS)
CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) NOT NULL UNIQUE,
  email                 VARCHAR(255) NOT NULL,
  phone                 VARCHAR(20),
  company_name          VARCHAR(255),
  cnpj                  VARCHAR(20),
  plan_id               UUID         NOT NULL REFERENCES plans(id),
  node_id               UUID         REFERENCES nodes(id),
  stripe_customer_id    VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  status                VARCHAR(20)  NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'suspended')),
  trial_ends_at         TIMESTAMPTZ,
  camera_count          INTEGER      NOT NULL DEFAULT 0,
  pdv_count             INTEGER      NOT NULL DEFAULT 0,
  billable_cameras      INTEGER      NOT NULL DEFAULT 0,
  node_tenant_id        UUID,
  settings              JSONB        DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_stripe ON tenants(stripe_customer_id);

-- Admin users (do VPS de controle, não dos nós)
CREATE TABLE admin_users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  hashed_password VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'admin',
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Billing events log
CREATE TABLE billing_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id),
  stripe_event_id VARCHAR(100) UNIQUE,
  event_type      VARCHAR(100) NOT NULL,
  amount_brl      NUMERIC(10,2),
  metadata        JSONB        DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Node health history
CREATE TABLE node_health_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  node_id     UUID        NOT NULL REFERENCES nodes(id),
  cpu_percent INTEGER,
  mem_percent INTEGER,
  disk_percent INTEGER,
  cameras_online INTEGER,
  cameras_total  INTEGER,
  response_ms    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_node_health_node ON node_health_log(node_id, created_at DESC);

-- Migrations tracking
CREATE TABLE _migrations (
  name       VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 6. API — Endpoints

### Public (sem auth — landing page)

```
GET    /api/plans                            # Listar planos ativos (para pricing page)
POST   /api/billing/checkout                 # Criar Stripe Checkout Session
POST   /api/billing/webhook                  # Stripe webhooks
GET    /api/billing/portal/:tenant_slug      # Redirect para Stripe Customer Portal
```

### Admin (auth JWT — dashboard admin)

```
# Tenants
GET    /api/admin/tenants                    # Listar todos (filtros: status, plan, node)
GET    /api/admin/tenants/:id                # Detalhes (com uso, billing)
POST   /api/admin/tenants                    # Criar manualmente
PUT    /api/admin/tenants/:id                # Atualizar (plano, status, nó)
DELETE /api/admin/tenants/:id                # Desativar

# Nodes
GET    /api/admin/nodes                      # Listar com capacidade/saúde
POST   /api/admin/nodes                      # Registrar nó existente
POST   /api/admin/nodes/provision            # Provisionar novo (Contabo API)
GET    /api/admin/nodes/:id/health           # Saúde detalhada
PUT    /api/admin/nodes/:id                  # Atualizar config

# Billing
GET    /api/admin/billing/overview           # MRR, churn, receita
GET    /api/admin/billing/events             # Log de eventos Stripe

# Dashboard
GET    /api/admin/dashboard                  # KPIs: tenants, câmeras, receita, saúde

# Auth
POST   /api/admin/auth/login
POST   /api/admin/auth/setup                 # Primeiro admin
```

### Internal (API Key — nós → controle)

```
POST   /api/internal/tenants/:id/usage       # Nó informa contagem de câmeras
POST   /api/internal/tenants/:id/status      # Nó informa status do tenant
GET    /api/internal/tenants/:id/limits      # Nó consulta limites do plano
```

---

## 7. Services

### services/stripe.js

```javascript
/**
 * Stripe integration
 * - Cria checkout sessions (per-unit pricing)
 * - Processa webhooks (create tenant, activate, suspend)
 * - Atualiza subscription quantity quando câmeras mudam
 * - Gera portal URL para self-service
 */

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createCheckoutSession(planId, email, quantity, tenantSlug) {
  // Busca plan com stripe_price_id
  // Cria session com mode: 'subscription', line_items: [{ price, quantity }]
  // success_url: flactech.com.br/welcome?session={CHECKOUT_SESSION_ID}
  // cancel_url: flactech.com.br/pricing
  // metadata: { tenant_slug, plan_id }
  // subscription_data: { trial_period_days (se tester) }
}

export async function handleWebhook(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      // Criar tenant + alocar nó
      break;
    case 'invoice.paid':
      // Ativar tenant
      break;
    case 'invoice.payment_failed':
      // Marcar past_due, enviar email
      break;
    case 'customer.subscription.updated':
      // Atualizar plano/quantidade
      break;
    case 'customer.subscription.deleted':
      // Desativar tenant
      break;
  }
}

export async function updateSubscriptionQuantity(subscriptionId, newQuantity) {
  // Stripe proration automática
}

export async function createPortalSession(stripeCustomerId) {
  // Retorna URL do Stripe Customer Portal
}
```

### services/provisioning.js

```javascript
/**
 * Tenant provisioning
 * 1. Seleciona nó com capacidade
 * 2. Cria tenant no nó via API interna
 * 3. Retorna credenciais
 */

export async function provisionTenant(tenant, plan) {
  // 1. Busca nó com menos uso e status 'active'
  const node = await selectNode(plan.max_cameras_per_pdv * plan.max_pdvs);

  // 2. Cria tenant no nó
  const response = await fetch(`http://${node.host}:${node.api_port}/api/internal/tenants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': node.api_key,
    },
    body: JSON.stringify({
      tenant_id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: plan.name,
      max_pdvs: plan.max_pdvs,
      max_cameras_per_pdv: plan.max_cameras_per_pdv,
      free_facial_per_pdv: plan.free_facial_per_pdv,
      retention_days: plan.retention_days,
      features: {
        video_search: plan.has_video_search,
        visitors: plan.has_visitors,
        erp_integration: plan.has_erp_integration,
      },
    }),
  });

  const { admin_credentials } = await response.json();

  // 3. Atualiza tenant no controle
  await pool.query(
    'UPDATE tenants SET node_id = $1, node_tenant_id = $2 WHERE id = $3',
    [node.id, tenant.id, tenant.id]
  );

  return {
    dashboard_url: `https://guard.flactech.com.br`,
    rtmp_host: node.host,
    credentials: admin_credentials,
  };
}

async function selectNode(estimatedCameras) {
  // Busca nó ativo com mais capacidade livre
  const { rows } = await pool.query(`
    SELECT * FROM nodes
    WHERE status = 'active'
      AND (max_cameras - current_cameras) >= $1
    ORDER BY (max_cameras - current_cameras) DESC
    LIMIT 1
  `, [Math.min(estimatedCameras, 10)]); // Reserva pelo menos 10 slots

  if (rows.length === 0) {
    throw new Error('No available nodes. Provision a new one.');
  }
  return rows[0];
}
```

### services/contabo.js

```javascript
/**
 * Contabo API integration
 * Provisiona novos VPS automaticamente quando nós existentes estão cheios
 */

const CONTABO_AUTH_URL = 'https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token';
const CONTABO_API_URL = 'https://api.contabo.com/v1';

async function getAccessToken() {
  // OAuth2 client_credentials flow
  // POST para CONTABO_AUTH_URL com client_id, client_secret, username, password
}

export async function provisionNode(nodeName, region = 'US-central') {
  const token = await getAccessToken();

  // Criar VPS 30 SSD via API
  const response = await fetch(`${CONTABO_API_URL}/compute/instances`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      imageId: 'ubuntu-22.04',     // ou custom image
      productId: 'V45',             // Cloud VPS 30 SSD
      region: region,
      displayName: nodeName,
      userData: generateCloudInit(), // cloud-init script
    }),
  });

  // Retorna instance ID + IP
  // Aguarda provisioning (~2 min)
  // Registra nó no banco
}

function generateCloudInit() {
  return `#!/bin/bash
# Flac Guard Node Setup
apt-get update && apt-get install -y docker.io docker-compose-plugin git
git clone https://github.com/andrelealpb/FlacGuard.git /opt/FlacGuard
cd /opt/FlacGuard
cp .env.example .env
# Configurar env vars...
docker compose up -d
docker compose exec api node src/db/migrate.js
`;
}
```

### services/email.js

```javascript
/**
 * Email transacional via Brevo (SMTP relay)
 * 
 * Configuração de email do Flac Guard:
 * 
 * 1. Google Workspace (@flactech.com.br)
 *    - Email corporativo: leal@, suporte@, contato@
 *    - Recebimento de emails de clientes
 *    - MX records apontam para Google
 * 
 * 2. Brevo (SMTP relay)
 *    - Email transacional: noreply@flactech.com.br
 *    - Boas-vindas, faturas, alertas, trial expiring
 *    - Reply-To: suporte@flactech.com.br (cai no Google Workspace)
 *    - Free tier: 300 emails/dia
 * 
 * DNS necessário:
 *   MX       → Google Workspace (receber emails)
 *   SPF      → include:_spf.google.com include:sendinblue.com
 *   DKIM     → Google + Brevo (ambos assinam)
 *   DMARC    → p=quarantine
 */

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.BREVO_SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
});

const EMAIL_FROM = process.env.EMAIL_FROM || 'Flac Guard <noreply@flactech.com.br>';
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || 'suporte@flactech.com.br';

const TEMPLATES = {
  welcome: (tenant, credentials) => ({
    subject: 'Bem-vindo ao Flac Guard!',
    html: `
      <h1>Olá, ${tenant.name}!</h1>
      <p>Sua conta Flac Guard está pronta.</p>
      <p><strong>Dashboard:</strong> <a href="https://guard.flactech.com.br">guard.flactech.com.br</a></p>
      <p><strong>Email:</strong> ${credentials.email}</p>
      <p><strong>Senha temporária:</strong> ${credentials.password}</p>
      <p>Próximo passo: cadastre seus PDVs e configure as câmeras.</p>
      <hr>
      <p style="color:#888">Dúvidas? Responda este email ou acesse suporte@flactech.com.br</p>
    `,
  }),

  trial_expiring: (tenant, daysLeft) => ({
    subject: `Seu período de teste termina em ${daysLeft} dias`,
    html: `
      <h1>${tenant.name}, seu trial está acabando</h1>
      <p>Faltam <strong>${daysLeft} dias</strong> para o fim do período de teste.</p>
      <p>Para continuar usando o Flac Guard, escolha um plano:</p>
      <p><a href="https://flactech.com.br/pricing">Ver planos</a></p>
    `,
  }),

  payment_failed: (tenant) => ({
    subject: 'Falha no pagamento — Flac Guard',
    html: `
      <h1>Não conseguimos processar seu pagamento</h1>
      <p>Atualize seus dados de pagamento para manter o acesso:</p>
      <p><a href="https://app.flactech.com.br/billing/${tenant.slug}">Atualizar pagamento</a></p>
      <p>Você tem 3 dias para regularizar antes da suspensão.</p>
    `,
  }),

  invoice_paid: (tenant, amount) => ({
    subject: `Fatura paga — R$ ${amount} — Flac Guard`,
    html: `
      <h1>Pagamento confirmado</h1>
      <p>Recebemos R$ ${amount} referente à sua assinatura Flac Guard.</p>
      <p>Detalhes da fatura disponíveis no portal:</p>
      <p><a href="https://app.flactech.com.br/billing/${tenant.slug}">Ver faturas</a></p>
    `,
  }),

  tenant_suspended: (tenant) => ({
    subject: 'Conta suspensa — Flac Guard',
    html: `
      <h1>Sua conta foi suspensa</h1>
      <p>Não recebemos o pagamento após o período de carência.</p>
      <p>Seus dados serão mantidos por 30 dias. Para reativar:</p>
      <p><a href="https://app.flactech.com.br/billing/${tenant.slug}">Regularizar pagamento</a></p>
    `,
  }),
};

export async function sendEmail(to, templateName, data) {
  const template = TEMPLATES[templateName];
  if (!template) throw new Error(`Unknown email template: ${templateName}`);

  const { subject, html } = template(...(Array.isArray(data) ? data : [data]));

  return transporter.sendMail({
    from: EMAIL_FROM,
    replyTo: EMAIL_REPLY_TO,
    to,
    subject,
    html,
  });
}
```

### services/node-health.js

```javascript
/**
 * Monitora saúde dos nós a cada 60s
 * Armazena histórico, alerta se nó cair
 */

export async function checkAllNodes() {
  const { rows: nodes } = await pool.query(
    "SELECT * FROM nodes WHERE status IN ('active', 'maintenance')"
  );

  for (const node of nodes) {
    try {
      const res = await fetch(
        `http://${node.host}:${node.api_port}/api/monitor/system`,
        {
          headers: { 'X-API-Key': node.api_key },
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = await res.json();

      await pool.query(`
        INSERT INTO node_health_log (node_id, cpu_percent, mem_percent, disk_percent,
          cameras_online, cameras_total, response_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [node.id, data.cpu?.percent, ...]);

      await pool.query(
        'UPDATE nodes SET last_health_at = now(), health_data = $1, current_cameras = $2 WHERE id = $3',
        [JSON.stringify(data), data.cameras?.online || 0, node.id]
      );
    } catch (err) {
      console.error(`Node ${node.name} health check failed:`, err.message);
      // Alerta se offline por >5 min
    }
  }
}

// Roda a cada 60s
setInterval(checkAllNodes, 60000);
```

---

## 8. Landing Page

### Estrutura

```
landing/
├── Dockerfile          # nginx:alpine serve estático
├── nginx.conf
├── index.html          # Home
├── pricing.html        # Planos com Stripe Pricing Table
├── css/
│   └── style.css
├── js/
│   └── main.js
└── assets/
    ├── logo.svg
    └── screenshots/
```

A pricing page usa **Stripe Pricing Table** (componente embeddable):

```html
<!-- pricing.html -->
<stripe-pricing-table
  pricing-table-id="prctbl_xxx"
  publishable-key="pk_live_xxx"
  client-reference-id="{{tenant_slug}}"
>
</stripe-pricing-table>
<script async src="https://js.stripe.com/v3/pricing-table.js"></script>
```

---

## 8.5 Configuração de Email (Google Workspace + Brevo)

### Passo 1: Google Workspace

1. Contratar Google Workspace Starter (R$ 28/usuário/mês) em workspace.google.com
2. Domínio: flactech.com.br
3. Criar contas: leal@flactech.com.br, suporte@flactech.com.br, contato@flactech.com.br
4. Configurar MX records no DNS:

```
MX  flactech.com.br  ASPMX.L.GOOGLE.COM         prioridade 1
MX  flactech.com.br  ALT1.ASPMX.L.GOOGLE.COM    prioridade 5
MX  flactech.com.br  ALT2.ASPMX.L.GOOGLE.COM    prioridade 5
MX  flactech.com.br  ALT3.ASPMX.L.GOOGLE.COM    prioridade 10
MX  flactech.com.br  ALT4.ASPMX.L.GOOGLE.COM    prioridade 10
```

5. Verificar domínio (TXT record fornecido pelo Google)

### Passo 2: Brevo (email transacional)

1. Criar conta em brevo.com (free tier: 300 emails/dia)
2. Adicionar domínio flactech.com.br
3. Configurar autenticação:

```
# DKIM (Brevo fornece o valor)
TXT  mail._domainkey.flactech.com.br  "v=DKIM1; k=rsa; p=MIGf..."

# Código de verificação Brevo
TXT  flactech.com.br  "brevo-code:xxxxxxxxxxxx"
```

4. Obter credenciais SMTP:
   - Host: smtp-relay.brevo.com
   - Porta: 587
   - Usuário: (email da conta Brevo)
   - Senha: (SMTP key gerada no painel)

### Passo 3: DNS unificado (SPF + DMARC)

```
# SPF — autoriza Google E Brevo a enviar em nome do domínio
TXT  flactech.com.br  "v=spf1 include:_spf.google.com include:sendinblue.com ~all"

# DMARC — política de proteção contra spoofing
TXT  _dmarc.flactech.com.br  "v=DMARC1; p=quarantine; rua=mailto:leal@flactech.com.br"

# DKIM Google (configurar no Google Admin Console → Apps → Gmail → Autenticação)
TXT  google._domainkey.flactech.com.br  "v=DKIM1; k=rsa; p=..."
```

### Resultado

| Tipo de email | Remetente | Serviço | Recebimento |
|--------------|-----------|---------|-------------|
| Corporativo (humano) | leal@flactech.com.br | Google Workspace | Gmail |
| Suporte (humano) | suporte@flactech.com.br | Google Workspace | Gmail |
| Transacional (automático) | noreply@flactech.com.br | Brevo SMTP | — (noreply) |
| Reply-To (quando cliente responde) | suporte@flactech.com.br | → Google Workspace | Gmail |

Quando um cliente responde um email transacional (ex: fatura), a resposta vai para suporte@flactech.com.br que cai no Gmail do Google Workspace.

---

### Páginas

| Rota | Função |
|------|--------|
| `/` | KPIs: total tenants, câmeras, MRR, nós ativos |
| `/tenants` | Lista tenants, filtros, busca |
| `/tenants/:id` | Detalhe: uso, billing, nó, câmeras |
| `/nodes` | Lista nós: capacidade, saúde, CPU/RAM/disco |
| `/nodes/:id` | Detalhe nó: tenants, health history |
| `/billing` | Receita, churn, faturas recentes |
| `/settings` | Config geral, Stripe keys, Contabo API |

---

## 10. Estrutura do Repositório

```
flac-guard-control/
├── .env.example
├── docker-compose.yml
├── README.md
├── server/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── db/
│       │   ├── schema.sql
│       │   ├── pool.js
│       │   └── migrate.js
│       ├── routes/
│       │   ├── plans.js           # GET /api/plans
│       │   ├── billing.js         # Checkout + webhook + portal
│       │   ├── admin-tenants.js   # CRUD tenants
│       │   ├── admin-nodes.js     # CRUD nós + provision
│       │   ├── admin-billing.js   # Relatórios
│       │   ├── admin-auth.js      # Login admin
│       │   ├── admin-dashboard.js # KPIs
│       │   └── internal.js        # Nós → controle (usage, status)
│       └── services/
│           ├── stripe.js
│           ├── provisioning.js
│           ├── contabo.js
│           ├── email.js
│           ├── node-health.js
│           └── auth.js
├── dashboard-admin/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── context/AuthContext.tsx
│       └── pages/
│           ├── Dashboard.tsx
│           ├── Tenants.tsx
│           ├── TenantDetail.tsx
│           ├── Nodes.tsx
│           ├── NodeDetail.tsx
│           ├── Billing.tsx
│           ├── Settings.tsx
│           └── Login.tsx
├── landing/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── index.html
│   ├── pricing.html
│   ├── css/style.css
│   ├── js/main.js
│   └── assets/
└── deploy/
    ├── setup.sh         # Instala nginx, certbot, docker
    ├── deploy.sh         # Git pull + rebuild
    └── nginx-host.conf   # Nginx config do host
```

---

## 11. Comunicação Controle ↔ Nós

### Controle → Nó (provisioning, queries)

**NOTA: Estes endpoints precisam ser criados no repo FlacGuard (nó) como parte da Fase 2.5B.**

```
POST   http://{node.host}:{api_port}/api/internal/tenants
  Headers: X-API-Key: {node.api_key}
  Body: { tenant_id, name, slug, plan, limits, features }
  → Cria tenant no banco do nó

DELETE http://{node.host}:{api_port}/api/internal/tenants/{tenant_id}
  → Desativa tenant no nó

PUT    http://{node.host}:{api_port}/api/internal/tenants/{tenant_id}/limits
  Body: { max_pdvs, max_cameras_per_pdv, retention_days, features }
  → Atualiza limites após upgrade/downgrade
```

### Nó → Controle (usage reporting)

```
POST   http://{control_host}/api/internal/tenants/{tenant_id}/usage
  Headers: X-API-Key: {control_api_key}
  Body: { camera_count, pdv_count, billable_cameras, storage_used_gb }
  → Controle atualiza tenant + Stripe subscription quantity
```

Frequência: nó reporta usage a cada 5 minutos.

---

## 12. Ordem de Implementação

### Passo 0: Endpoints internos no nó FlacGuard (Claude Code, ~1h)
- [ ] Criar routes/internal.js no repo FlacGuard (nó de processamento)
- [ ] POST /api/internal/tenants (criar tenant, chamado pelo controle)
- [ ] DELETE /api/internal/tenants/:id (desativar tenant)
- [ ] PUT /api/internal/tenants/:id/limits (atualizar limites após upgrade)
- [ ] GET /api/internal/tenants/:id/usage (retorna câmeras, PDVs, storage)
- [ ] Autenticação via X-Internal-Key (chave compartilhada controle↔nó)
- [ ] Deploy no nó #1

### Passo 1: Setup VPS (manual, 30 min)
- [ ] Provisionar Cloud VPS 10 na Contabo (US-Central)
- [ ] DNS: apontar flactech.com.br e app.flactech.com.br para novo IP
- [ ] Instalar Docker, Nginx, Certbot
- [ ] SSL para flactech.com.br + app.flactech.com.br

### Passo 2: Repo + API base (Claude Code, ~3h)
- [ ] Criar repo `flac-guard-control` no GitHub
- [ ] Docker Compose + schema + migrations
- [ ] Routes: plans, admin-auth, admin-dashboard
- [ ] Admin dashboard básico (login + KPIs)

### Passo 3: Landing page (Claude Code, ~2h)
- [ ] index.html (site comercial)
- [ ] pricing.html (planos + CTA)
- [ ] Nginx config do host

### Passo 4: Stripe integration (Claude Code, ~4h)
- [ ] Criar products + prices no Stripe Dashboard
- [ ] services/stripe.js (checkout, webhook, portal)
- [ ] routes/billing.js
- [ ] Pricing table na landing page
- [ ] Testar fluxo completo (checkout → webhook → tenant)

### Passo 5: Provisioning (Claude Code, ~3h)
- [ ] services/provisioning.js
- [ ] Endpoint interno no FlacGuard (nó) para criar tenant
- [ ] routes/admin-tenants.js (CRUD)
- [ ] Testar: Stripe checkout → tenant criado no nó

### Passo 6: Node management (Claude Code, ~2h)
- [ ] routes/admin-nodes.js
- [ ] services/node-health.js
- [ ] services/contabo.js (provisioning automático)

### Passo 7: Email (manual + Claude Code, ~2h)
- [ ] Contratar Google Workspace (workspace.google.com)
- [ ] Criar contas: leal@, suporte@, contato@flactech.com.br
- [ ] Configurar MX records no DNS
- [ ] Criar conta Brevo (brevo.com)
- [ ] Configurar DKIM + SPF + DMARC no DNS
- [ ] services/email.js (nodemailer + Brevo SMTP)
- [ ] Templates: welcome, trial_expiring, payment_failed, invoice_paid, suspended
- [ ] Integrar nos webhooks do Stripe
- [ ] Testar: envio noreply@ + resposta cai no suporte@ (Gmail)

### Passo 8: Go-to-market
- [ ] Documentação para cliente (como configurar câmeras)
- [ ] Primeiro tenant teste externo
- [ ] Monitorar billing + nó
