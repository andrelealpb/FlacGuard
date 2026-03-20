# Flac Guard — Plano de Escala (Fase 2.5)

> Documento técnico para implementação no Claude Code
> Data: Março 2026
> Decisões tomadas:
> - Upgrade: Cloud VPS 20 NVMe (6 cores, 12GB, 100GB NVMe)
> - Object Storage: Contabo S3 (€2.49/250GB, interno)
> - Multi-tenant: tenant_id no banco desde agora

---

## Ação 1: Upgrade VPS (manual no painel Contabo)

### O que fazer
1. Acessar painel Contabo → VPS → Cloud VPS 10 NVMe (147.93.7.251)
2. Clicar "Upgrade" → Cloud VPS 20 NVMe ($10.75/mês)
3. Specs: 6 cores, 12GB RAM, 100GB NVMe, 300 Mbit/s

### Antes do upgrade
```bash
# Backup do banco (executar no VPS)
docker compose exec db pg_dump -U flac_guard flac_guard > /opt/FlacGuard/backup-pre-upgrade.sql

# Verificar volumes Docker (serão preservados no upgrade)
docker volume ls | grep flac-guard
```

### Após o upgrade
```bash
# Verificar novo espaço
df -h /

# Limpar Docker (liberar 10-20GB de images antigas)
docker system prune -a --volumes --filter "until=72h"
docker builder prune -a

# Verificar espaço recuperado
df -h /
```

### Resultado esperado
- De 75GB → 100GB NVMe
- Limpeza Docker libera ~15-20GB adicionais
- RAM: 8GB → 12GB (face-service mais confortável)
- CPU: 4 → 6 cores (pipeline de frames mais rápido)

---

## Ação 2: Object Storage Contabo S3

### 2.1 Provisionar o bucket

1. Painel Contabo → Object Storage → Criar
2. Região: mesma do VPS (provavelmente EU)
3. Bucket name: `flac-guard-recordings`
4. Plano: S3 Storage 250GB (€2.49/mês)
5. Anotar: `access_key`, `secret_key`, `endpoint_url`

### 2.2 Variáveis de ambiente

Adicionar ao `.env`:

```bash
# Contabo S3 Object Storage
S3_ENDPOINT=https://eu2.contabostorage.com      # ou o endpoint fornecido
S3_BUCKET=flac-guard-recordings
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=eu2                                     # região Contabo
S3_RECORDINGS_PREFIX=recordings                   # prefixo no bucket
S3_FACES_PREFIX=faces                             # prefixo para face images
```

Adicionar ao `docker-compose.yml` no serviço `api`:

```yaml
api:
  environment:
    # ... (existentes)
    - S3_ENDPOINT=${S3_ENDPOINT:-}
    - S3_BUCKET=${S3_BUCKET:-}
    - S3_ACCESS_KEY=${S3_ACCESS_KEY:-}
    - S3_SECRET_KEY=${S3_SECRET_KEY:-}
    - S3_REGION=${S3_REGION:-eu2}
    - S3_RECORDINGS_PREFIX=${S3_RECORDINGS_PREFIX:-recordings}
    - S3_FACES_PREFIX=${S3_FACES_PREFIX:-faces}
```

### 2.3 Novo service: `services/storage.js`

Criar `server/api/src/services/storage.js`:

```javascript
/**
 * Flac Guard — S3 Object Storage service
 * 
 * Handles upload/download of recordings and face images to Contabo S3.
 * Falls back to local disk if S3 is not configured.
 * 
 * Padrão de chaves no bucket:
 *   recordings/{tenant_id}/{camera_id}/{YYYY-MM-DD}/{filename}.mp4
 *   faces/{tenant_id}/{camera_id}/{YYYY-MM-DD}/{filename}.jpg
 *   watchlist/{tenant_id}/{watchlist_id}.jpg
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, 
         ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, existsSync, statSync, unlinkSync } from 'fs';

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_REGION = process.env.S3_REGION || 'eu2';
const RECORDINGS_PREFIX = process.env.S3_RECORDINGS_PREFIX || 'recordings';
const FACES_PREFIX = process.env.S3_FACES_PREFIX || 'faces';

let s3Client = null;

export function isS3Configured() {
  return !!(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

function getClient() {
  if (!s3Client && isS3Configured()) {
    s3Client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true, // Contabo requer path-style
    });
  }
  return s3Client;
}

/**
 * Upload file to S3. Returns the S3 key.
 * After successful upload, deletes the local file.
 */
export async function uploadRecording(localPath, tenantId, cameraId, filename) {
  const client = getClient();
  if (!client) return null; // S3 not configured, keep local

  const date = new Date().toISOString().split('T')[0];
  const key = `${RECORDINGS_PREFIX}/${tenantId}/${cameraId}/${date}/${filename}`;

  const fileStream = createReadStream(localPath);
  const fileSize = statSync(localPath).size;

  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: 'video/mp4',
    ContentLength: fileSize,
  }));

  // Delete local file after successful upload
  try { unlinkSync(localPath); } catch { /* ignore */ }

  return key;
}

/**
 * Upload face image to S3.
 */
export async function uploadFaceImage(localPath, tenantId, cameraId, filename) {
  const client = getClient();
  if (!client) return null;

  const date = new Date().toISOString().split('T')[0];
  const key = `${FACES_PREFIX}/${tenantId}/${cameraId}/${date}/${filename}`;

  const fileStream = createReadStream(localPath);
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: 'image/jpeg',
  }));

  try { unlinkSync(localPath); } catch { /* ignore */ }
  return key;
}

/**
 * Generate a pre-signed URL for playback/download (expires in 1 hour).
 */
export async function getPresignedUrl(s3Key, expiresIn = 3600) {
  const client = getClient();
  if (!client) return null;

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Delete object from S3.
 */
export async function deleteObject(s3Key) {
  const client = getClient();
  if (!client) return;

  await client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));
}

/**
 * Delete all objects with a given prefix (e.g., all recordings for a camera).
 */
export async function deleteByPrefix(prefix) {
  const client = getClient();
  if (!client) return 0;

  let deleted = 0;
  let continuationToken;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents || []) {
      await client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: obj.Key,
      }));
      deleted++;
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return deleted;
}
```

### 2.4 Dependência npm

```bash
# No diretório server/api/
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### 2.5 Alterações no banco de dados

Nova migration `007_s3_storage.sql`:

```sql
-- Migration 007: S3 storage support

-- Add s3_key to recordings (NULL = local disk, set = S3)
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS s3_key VARCHAR(1000);

-- Add s3_key to face_embeddings for face images
ALTER TABLE face_embeddings ADD COLUMN IF NOT EXISTS face_image_s3_key VARCHAR(1000);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_recordings_s3_key ON recordings(s3_key) WHERE s3_key IS NOT NULL;
```

### 2.6 Alterações no Recorder

No `services/recorder.js`, após a gravação finalizar com sucesso:

```javascript
// Após gravar MP4 e inserir no banco:
import { uploadRecording, isS3Configured } from './storage.js';

// ... no bloco ffmpeg.on('close'):
if (fileSize && fileSize > 10240) {
  // Insert recording in DB (existente)
  const { rows } = await pool.query(
    `INSERT INTO recordings (...) VALUES (...) RETURNING id`,
    [...]
  );

  // Upload to S3 if configured
  if (isS3Configured()) {
    try {
      const tenantId = await getTenantIdForCamera(cameraId); // ver Ação 3
      const s3Key = await uploadRecording(filePath, tenantId, cameraId, filename);
      if (s3Key) {
        await pool.query(
          'UPDATE recordings SET s3_key = $1 WHERE id = $2',
          [s3Key, rows[0].id]
        );
        console.log(`[Recorder] Uploaded to S3: ${s3Key}`);
      }
    } catch (err) {
      console.error(`[Recorder] S3 upload failed, keeping local: ${err.message}`);
      // Não deleta o arquivo local se o upload falhar
    }
  }
}
```

### 2.7 Alterações no Playback

No `routes/recordings.js`, endpoint de stream/download:

```javascript
import { getPresignedUrl } from '../services/storage.js';

// GET /api/recordings/:id/stream
// Se recording tem s3_key → redirect para pre-signed URL
// Se não → serve do disco local (comportamento atual)

if (recording.s3_key) {
  const url = await getPresignedUrl(recording.s3_key, 3600);
  return res.redirect(302, url);
}
// ... fallback para disco local (código existente)
```

### 2.8 Alterações no Cleanup

No `services/cleanup.js`:

```javascript
import { deleteObject } from './storage.js';

// No loop de deleção de gravações antigas:
if (recording.s3_key) {
  await deleteObject(recording.s3_key);
}
// ... manter deleção do arquivo local (código existente) como fallback
```

### 2.9 Fluxo completo

```
Câmera → RTMP → Nginx → HLS
                          ↓
Motion Detector detecta movimento
                          ↓
FFmpeg grava MP4 no disco local (/data/recordings/temp/)
                          ↓
Gravação finalizada → INSERT no banco
                          ↓
S3 configurado?
  SIM → upload para Contabo S3 → UPDATE s3_key → DELETE arquivo local
  NÃO → manter no disco local (comportamento atual)
                          ↓
Playback solicitado
  s3_key existe → redirect para pre-signed URL (1h)
  s3_key NULL → serve do disco local
```

---

## Ação 3: Multi-tenant (tenant_id)

### 3.1 Conceito

Cada "cliente" do SaaS é um tenant. A Happydo Mercadinhos é o primeiro tenant. Toda tabela principal recebe um `tenant_id`. Queries sempre filtram por tenant. Isolamento lógico, não físico.

### 3.2 Migration `008_multi_tenant.sql`

```sql
-- Migration 008: Multi-tenant support

-- Tenants table (SaaS clients)
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,  -- URL-friendly: 'happydo', 'empresa-x'
  plan        VARCHAR(50)  NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'professional', 'enterprise')),
  max_cameras INTEGER      NOT NULL DEFAULT 10,
  max_storage_gb INTEGER   NOT NULL DEFAULT 50,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  settings    JSONB        DEFAULT '{}',  -- tenant-specific config
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Create default tenant (Happydo = tenant zero)
INSERT INTO tenants (name, slug, plan, max_cameras, max_storage_gb)
VALUES ('Happydo Mercadinhos', 'happydo', 'enterprise', 200, 1000)
ON CONFLICT (slug) DO NOTHING;

-- Add tenant_id to all main tables
-- Default to the Happydo tenant for existing data

DO $$
DECLARE
  default_tenant UUID;
BEGIN
  SELECT id INTO default_tenant FROM tenants WHERE slug = 'happydo';

  -- PDVs
  ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE pdvs SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE pdvs ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE pdvs ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_pdvs_tenant ON pdvs(tenant_id);

  -- Cameras
  ALTER TABLE cameras ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE cameras SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE cameras ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE cameras ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_cameras_tenant ON cameras(tenant_id);

  -- Users (users belong to a tenant)
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE users SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

  -- API Keys
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE api_keys SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE api_keys ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE api_keys ALTER COLUMN tenant_id SET DEFAULT default_tenant;

  -- Webhooks
  ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE webhooks SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE webhooks ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN tenant_id SET DEFAULT default_tenant;

  -- Face watchlist
  ALTER TABLE face_watchlist ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE face_watchlist SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_watchlist_tenant ON face_watchlist(tenant_id);

END $$;
```

### 3.3 Alterações na autenticação

No `services/auth.js`, o token JWT passa a incluir `tenant_id`:

```javascript
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}
```

No middleware `authenticate()`, após validar o token:

```javascript
req.auth = { 
  type: 'jwt', 
  user: decoded,
  tenantId: decoded.tenant_id  // disponível em todo request
};
```

Para API Keys:

```javascript
req.auth = { 
  type: 'api_key', 
  key: rows[0],
  tenantId: rows[0].tenant_id
};
```

### 3.4 Helper de tenant filtering

Criar `services/tenant.js`:

```javascript
/**
 * Flac Guard — Tenant isolation helper
 * 
 * Provides tenant_id from request context and query helpers.
 * EVERY query to a tenanted table MUST use these helpers.
 */

export function getTenantId(req) {
  return req.auth?.tenantId || req.auth?.user?.tenant_id || req.auth?.key?.tenant_id;
}

/**
 * Add tenant filter to a SQL query.
 * Usage: const { condition, param, idx } = tenantFilter(req, startIdx);
 *        conditions.push(condition);
 *        params.push(param);
 */
export function tenantFilter(req, paramIdx = 1) {
  const tenantId = getTenantId(req);
  return {
    condition: `tenant_id = $${paramIdx}`,
    param: tenantId,
    idx: paramIdx + 1,
  };
}
```

### 3.5 Exemplo de alteração em uma route

Antes (sem tenant):
```javascript
router.get('/', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cameras ORDER BY name');
  res.json(rows);
});
```

Depois (com tenant):
```javascript
import { getTenantId } from '../services/tenant.js';

router.get('/', authenticate, async (req, res) => {
  const tenantId = getTenantId(req);
  const { rows } = await pool.query(
    'SELECT * FROM cameras WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
  res.json(rows);
});
```

### 3.6 Tabelas que NÃO recebem tenant_id

Estas tabelas são derivadas de tabelas que já têm tenant_id (via camera_id):

- `recordings` → filtradas via JOIN com cameras.tenant_id
- `events` → filtradas via JOIN com cameras.tenant_id
- `face_embeddings` → filtradas via JOIN com cameras.tenant_id
- `face_alerts` → filtradas via JOIN
- `daily_visitors` → filtradas via JOIN
- `face_search_log` → filtradas via user_id → users.tenant_id
- `system_alerts` → filtradas via camera_id → cameras.tenant_id

Tabela `settings` é global (configuração do sistema, não do tenant). No futuro, settings por tenant vão no campo `tenants.settings` (JSONB).

### 3.7 Stream keys com prefixo de tenant

Para garantir unicidade global de stream keys (múltiplos tenants no mesmo Nginx-RTMP):

```javascript
// Em rtmp.js, alterar generateStreamKey():
export function generateStreamKey(tenantSlug) {
  const random = crypto.randomBytes(16).toString('base64url');
  return `${tenantSlug}_${random}`;
  // Exemplo: happydo_abc123def456
}
```

O callback `on_publish` no hooks.js identifica o tenant pela stream key e valida.

---

## Ordem de Implementação

### Passo 1: Upgrade VPS (manual, 5 min)
- [ ] Fazer upgrade no painel Contabo
- [ ] Limpar Docker (`docker system prune -a`)
- [ ] Verificar espaço disponível

### Passo 2: Multi-tenant no banco (Claude Code, ~2h)
- [ ] Criar migration 008_multi_tenant.sql
- [ ] Criar services/tenant.js
- [ ] Alterar services/auth.js (tenant_id no JWT)
- [ ] Alterar TODAS as routes para filtrar por tenant_id
- [ ] Alterar hooks.js (stream key com tenant slug)
- [ ] Testar: login → token tem tenant_id → queries filtradas
- [ ] Dados existentes migrados automaticamente para tenant 'happydo'

### Passo 3: Object Storage (Claude Code, ~3h)
- [ ] Provisionar Contabo S3 (manual no painel)
- [ ] Instalar @aws-sdk/client-s3
- [ ] Criar migration 007_s3_storage.sql
- [ ] Criar services/storage.js
- [ ] Alterar services/recorder.js (upload após gravação)
- [ ] Alterar routes/recordings.js (pre-signed URL para playback)
- [ ] Alterar services/cleanup.js (deletar do S3)
- [ ] Adicionar env vars no .env e docker-compose.yml
- [ ] Testar: gravação → upload S3 → playback via pre-signed URL

### Passo 4: Verificação
- [ ] Dashboard funciona normalmente (tenant transparente)
- [ ] Gravações novas vão pro S3
- [ ] Gravações antigas continuam acessíveis (disco local)
- [ ] Playback funciona (S3 e local)
- [ ] Cleanup deleta do S3 e do local
- [ ] Disco do VPS liberado significativamente

---

## Migração Futura: Contabo S3 → Backblaze B2

Quando o SaaS tiver múltiplos clientes com playback intenso:

1. Trocar env vars (endpoint, credentials, region)
2. Adicionar Cloudflare CDN na frente (egress gratuito)
3. Migrar objetos existentes com `aws s3 sync`
4. Zero alteração no código (tudo via env vars)
