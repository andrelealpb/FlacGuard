# Configurar Object Storage S3 — Contabo

Guia passo a passo para ativar o armazenamento S3 no FlacGuard.
Sem S3 configurado, tudo continua funcionando normalmente (disco local).

---

## 1. Criar o Object Storage no painel Contabo

1. Acesse [https://my.contabo.com/objectstorage](https://my.contabo.com/objectstorage)
2. Clique **"Get S3-compatible Object Storage"**
3. Escolha a **regiao** (recomendado: mesma do VPS para menor latencia)
   - `EU` (Nuremberg) → endpoint: `https://eu2.contabostorage.com`
   - `US-central` → endpoint: `https://usc1.contabostorage.com`
   - `US-east` → endpoint: `https://use1.contabostorage.com`
   - `SIN` (Singapore) → endpoint: `https://sin1.contabostorage.com`
4. Escolha o plano:
   - **250 GB** (~2.49 EUR/mes) — suficiente para 1-3 lojas
   - **500 GB** (~4.99 EUR/mes) — para 3-10 lojas
   - **1 TB+** para mais
5. Finalize a compra

## 2. Obter as credenciais

1. Apos criado, va em **Object Storage** → **Manage**
2. Anote:
   - **S3 URL** (endpoint): ex. `https://eu2.contabostorage.com`
   - **Access Key**: chave de acesso
   - **Secret Key**: chave secreta
   - **Region**: ex. `eu2` (corresponde ao endpoint)

## 3. Criar o bucket

Usando o AWS CLI (instalado na VPS ou local):

```bash
# Instalar AWS CLI (se nao tiver)
apt install -y awscli

# Configurar credenciais
aws configure
# AWS Access Key ID: <sua-access-key>
# AWS Secret Access Key: <sua-secret-key>
# Default region: eu2
# Default output format: json

# Criar o bucket
aws s3 mb s3://flac-guard-recordings \
  --endpoint-url https://eu2.contabostorage.com

# Verificar
aws s3 ls --endpoint-url https://eu2.contabostorage.com
```

Ou via **Contabo S3 Panel** (web):
1. Acesse o endpoint no navegador (ex. `https://eu2.contabostorage.com`)
2. Crie o bucket `flac-guard-recordings`

## 4. Configurar no FlacGuard

Edite o arquivo `.env` na raiz do projeto:

```bash
# S3 Object Storage
S3_ENDPOINT=https://eu2.contabostorage.com
S3_BUCKET=flac-guard-recordings
S3_ACCESS_KEY=sua-access-key-aqui
S3_SECRET_KEY=sua-secret-key-aqui
S3_REGION=eu2
S3_RECORDINGS_PREFIX=recordings
S3_FACES_PREFIX=faces
S3_WATCHLIST_PREFIX=watchlist
```

## 5. Reiniciar os containers

```bash
cd /opt/flac-guard   # ou onde esta o projeto
docker compose down && docker compose up -d
```

## 6. Verificar

### Via API (terminal):

```bash
# Health check detalhado do S3
curl -s -H "Authorization: Bearer SEU_TOKEN" \
  http://localhost:8000/api/monitor/s3 | jq .
```

Resposta esperada:
```json
{
  "configured": true,
  "status": "healthy",
  "endpoint": "https://eu2.contabostorage.com",
  "bucket": "flac-guard-recordings",
  "region": "eu2",
  "latency_ms": 45,
  "error": null,
  "recordings": {
    "in_s3": 0,
    "local_only": 142,
    "s3_size": 0,
    "local_size": 15032385536
  }
}
```

### Via Dashboard:

Acesse **Monitoramento** → card **"Object Storage (S3)"** na parte inferior.
Mostra:
- Status: Ativo/Nao configurado
- Endpoint e bucket
- Quantidade de gravacoes no S3 vs local
- Barra de progresso da migracao

## 7. Como funciona

```
Gravacao termina
      |
      v
  Salva MP4 local (/data/recordings/)
      |
      v
  INSERT no banco (file_path, file_size)
      |
      v
  S3 configurado?
    SIM → Upload para S3 → UPDATE s3_key → DELETE arquivo local
    NAO → Nada (mantem local)
      |
      v
  Playback solicitado
    s3_key existe → redirect 302 para pre-signed URL (1h)
    s3_key NULL → serve do disco local
```

**Gravacoes antigas** (feitas antes do S3) continuam acessiveis pelo disco local.
Novas gravacoes vao automaticamente para o S3 e liberam espaco no disco.

## 8. Troubleshooting

### S3 status "error" no monitor

```bash
# Verificar se as credenciais estao corretas
aws s3 ls s3://flac-guard-recordings \
  --endpoint-url https://eu2.contabostorage.com

# Erros comuns:
# - "Access Denied" → credenciais erradas
# - "NoSuchBucket" → bucket nao foi criado
# - "Could not connect" → endpoint errado ou rede bloqueada
```

### Gravacoes nao estao indo para S3

1. Verificar se as env vars estao no container:
   ```bash
   docker compose exec api env | grep S3
   ```
2. Verificar logs da API:
   ```bash
   docker compose logs api --tail=50 | grep S3
   ```

### Migrar gravacoes antigas para S3

As gravacoes antigas ficam no disco local (s3_key = NULL).
Para migra-las manualmente:

```bash
# Listar gravacoes locais
aws s3 sync /data/recordings/ s3://flac-guard-recordings/recordings/ \
  --endpoint-url https://eu2.contabostorage.com
```

Nota: isso copia os arquivos mas nao atualiza o `s3_key` no banco.
Uma migracao completa requer um script que faca upload + UPDATE.

## 9. Custos estimados (Contabo)

| Plano | Espaco | Preco | Cameras estimadas |
|-------|--------|-------|-------------------|
| S3 250 GB | 250 GB | ~2.49 EUR/mes | 1-3 lojas |
| S3 500 GB | 500 GB | ~4.99 EUR/mes | 3-10 lojas |
| S3 1 TB | 1000 GB | ~9.49 EUR/mes | 10-25 lojas |

**Trafego de saida**: 1 TB/mes incluido em cada plano.
O trafego entre VPS e S3 na mesma regiao Contabo e gratuito.

## 10. Migracao futura: Contabo → Backblaze B2

Quando crescer:
1. Trocar as env vars (endpoint, credentials, region)
2. Colocar Cloudflare CDN na frente (egress gratuito via alianca B2+Cloudflare)
3. Migrar objetos: `aws s3 sync` entre os dois
4. Zero alteracao no codigo
