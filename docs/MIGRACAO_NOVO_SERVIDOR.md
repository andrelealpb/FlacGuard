# Checklist de Migracao — Novo Servidor Contabo

**De:** VPS antigo (IP anterior)
**Para:** Cloud VPS 20 NVMe — IP `147.93.7.251` (Carlstadt, US East)
**OS:** Ubuntu 24.04
**VNC:** `144.126.149.10:63315`

---

## Fase 1 — Acesso e preparacao do servidor

### 1.1 Conectar via SSH

```bash
ssh root@147.93.7.251
```

Se a chave SSH nao foi migrada, usar VNC primeiro para configurar:
```bash
# Via VNC (144.126.149.10:63315)
mkdir -p ~/.ssh
echo "SUA_CHAVE_PUBLICA" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 1.2 Expandir particao do disco

A Contabo avisou que o espaco adicional precisa de expansao manual:

```bash
# Ver situacao atual
lsblk
df -h

# Expandir (geralmente /dev/vda1 ou /dev/sda1)
sudo growpart /dev/vda 1
sudo resize2fs /dev/vda1

# Verificar
df -h
# Deve mostrar ~100GB+ agora
```

Se usar XFS ao inves de ext4:
```bash
sudo xfs_growfs /
```

### 1.3 Atualizar sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo reboot
```

---

## Fase 2 — Instalar dependencias

### 2.1 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Relogar para ativar grupo docker
exit
ssh root@147.93.7.251

# Verificar
docker --version
docker compose version
```

### 2.2 Ferramentas auxiliares

```bash
sudo apt install -y git curl ufw htop awscli
```

---

## Fase 3 — Firewall

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (redirect para HTTPS)
sudo ufw allow 443/tcp    # HTTPS (dashboard)
sudo ufw allow 1935/tcp   # RTMP (cameras)
sudo ufw allow 9000/tcp   # Webhook deploy (temporario, fechar depois se quiser)
sudo ufw enable
sudo ufw status
```

---

## Fase 4 — Clonar e configurar o projeto

### 4.1 Clonar repositorio

```bash
git clone https://github.com/andrelealpb/FlacGuard.git /opt/FlacGuard
cd /opt/FlacGuard
```

### 4.2 Criar .env de producao

```bash
cp .env.example .env
nano .env
```

Preencher:
```bash
# JWT — gerar um novo secret
JWT_SECRET=$(openssl rand -hex 32)

# Banco de dados — trocar a senha padrao!
POSTGRES_USER=flac_guard
POSTGRES_PASSWORD=TROCAR_PARA_SENHA_FORTE
POSTGRES_DB=flac_guard

# HappyDo Pulse
PULSE_API_URL=https://happydopulse-production.up.railway.app/api
PULSE_EMAIL=seu-email
PULSE_PASSWORD=sua-senha

# Webhook (sera gerado pelo setup.sh)
WEBHOOK_SECRET=

# S3 Contabo (opcional — ver docs/SETUP_S3_CONTABO.md)
S3_ENDPOINT=
S3_BUCKET=flac-guard-recordings
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=us-east-1
S3_RECORDINGS_PREFIX=recordings
S3_FACES_PREFIX=faces
S3_WATCHLIST_PREFIX=watchlist
```

### 4.3 Criar volumes Docker

```bash
docker volume create flac-guard_pgdata
docker volume create flac-guard_hls_data
docker volume create flac-guard_recordings
```

### 4.4 Subir servicos

```bash
cd /opt/FlacGuard
docker compose up -d
```

### 4.5 Rodar migrations do banco

```bash
docker compose exec api node src/db/migrate.js
```

### 4.6 Verificar saude

```bash
# API
curl http://localhost:8000/health

# RTMP
curl http://localhost:8080/health

# Face service (demora ~60s para carregar modelos)
curl http://localhost:8001/health

# Dashboard
curl -I http://localhost:3000
```

---

## Fase 5 — Migrar dados do servidor antigo (se necessario)

### 5.1 Exportar banco de dados (servidor antigo)

```bash
# No servidor ANTIGO
docker compose exec db pg_dump -U flac_guard flac_guard > /tmp/flac_guard_backup.sql
scp /tmp/flac_guard_backup.sql root@147.93.7.251:/tmp/
```

### 5.2 Importar banco de dados (servidor novo)

```bash
# No servidor NOVO
docker compose exec -T db psql -U flac_guard flac_guard < /tmp/flac_guard_backup.sql
```

### 5.3 Migrar gravacoes (se quiser manter historico)

```bash
# No servidor ANTIGO — copiar para o novo
rsync -avz --progress /var/lib/docker/volumes/flac-guard_recordings/_data/ \
  root@147.93.7.251:/var/lib/docker/volumes/flac-guard_recordings/_data/
```

Ou, se preferir, configure o S3 e deixe as gravacoes antigas para tras.
Novas gravacoes irao direto para o Object Storage.

---

## Fase 6 — Configurar DNS e dominio

### 6.1 Registros DNS (no painel do registrador — Registro.br ou similar)

Como `flactech.com.br` ja esta concluido, configurar:

```
Tipo   Nome                      Valor              TTL
A      guard.flactech.com.br     147.93.7.251       300
A      flactech.com.br           147.93.7.251       300
```

Quando `flacsistemas.com.br` ficar pronto:
```
Tipo    Nome                         Valor                     TTL
CNAME   guard.flacsistemas.com.br    guard.flactech.com.br     300
CNAME   flacsistemas.com.br          flactech.com.br           300
```

### 6.2 Verificar propagacao DNS

```bash
# Testar (pode levar 5-30 min)
dig guard.flactech.com.br +short
# Deve retornar: 147.93.7.251

nslookup guard.flactech.com.br
```

Site util: https://dnschecker.org

### 6.3 HTTPS com Let's Encrypt

```bash
sudo apt install -y certbot

# Parar o dashboard temporariamente (porta 80 precisa estar livre)
docker compose stop dashboard

# Gerar certificado
sudo certbot certonly --standalone \
  -d guard.flactech.com.br \
  --agree-tos \
  -m seu-email@dominio.com

# Reiniciar dashboard
docker compose start dashboard
```

Certificado gerado em:
- `/etc/letsencrypt/live/guard.flactech.com.br/fullchain.pem`
- `/etc/letsencrypt/live/guard.flactech.com.br/privkey.pem`

### 6.4 Renovacao automatica

```bash
# Certbot ja instala um timer, verificar:
sudo systemctl list-timers | grep certbot

# Testar renovacao
sudo certbot renew --dry-run
```

---

## Fase 7 — Configurar webhook de deploy automatico

```bash
cd /opt/FlacGuard
sudo bash deploy/setup.sh
```

Depois no GitHub:
1. Ir em: https://github.com/andrelealpb/FlacGuard/settings/hooks
2. Editar o webhook existente (ou criar novo)
3. Payload URL: `http://147.93.7.251:9000/webhook` (ou `http://guard.flactech.com.br:9000/webhook`)
4. Secret: o valor gerado pelo setup.sh (ver no `.env`)
5. Events: apenas "push"

Testar:
```bash
curl http://localhost:9000/status
```

---

## Fase 8 — Configurar cameras

### 8.1 Atualizar endereco RTMP no dashboard

1. Acessar `http://147.93.7.251:3000` (ou `https://guard.flactech.com.br`)
2. Ir em **Configuracoes** → **Servidor RTMP**
3. Alterar IP/dominio para: `guard.flactech.com.br` (recomendado) ou `147.93.7.251`
4. Porta: `1935`
5. Salvar

### 8.2 Reconfigurar cameras Intelbras (iM3 C, iM5 SC, iMX)

Para cada camera com RTMP nativo:

1. Acessar a camera via navegador (IP local da camera)
2. Ir em **Configuracao** → **Rede** → **RTMP**
3. Alterar o endereco do servidor RTMP:
   ```
   Antes:  rtmp://IP_ANTIGO:1935/live/STREAM_KEY
   Depois: rtmp://guard.flactech.com.br:1935/live/STREAM_KEY
   ```
4. A stream key de cada camera permanece a mesma
5. Ativar e salvar

**Dica:** usando o dominio `guard.flactech.com.br` em vez do IP,
futuras migracoes de servidor so precisam mudar o DNS — sem tocar nas cameras.

### 8.3 Reconfigurar agentes Pi Zero (cameras IC3/IC5)

Para cada Pi Zero rodando o agente:

```bash
ssh pi@IP_DO_PI_ZERO

sudo nano /etc/flac-guard-agent.conf
# Alterar SERVER_URL:
# SERVER_URL=rtmp://guard.flactech.com.br:1935/live

sudo systemctl restart flac-guard-agent
```

### 8.4 Verificar que todas as cameras estao online

1. No dashboard → **Cameras**
2. Todas devem mostrar status "online" dentro de ~90 segundos
3. Se alguma ficar offline, verificar:
   - Firewall: porta 1935 aberta? (`sudo ufw status`)
   - DNS: camera resolve o dominio? (cameras Intelbras mais antigas podem precisar de IP)
   - Stream key: mesma de antes?

---

## Fase 9 — Validacao final

### Checklist pos-migracao

```
[ ] SSH funcionando no novo IP
[ ] Particao expandida (df -h mostra espaco total)
[ ] Firewall ativo (ufw status)
[ ] Docker rodando (docker ps)
[ ] Todos os 5 containers up (api, dashboard, db, nginx-rtmp, face-service)
[ ] API health OK (curl localhost:8000/health)
[ ] Face service com modelo carregado (curl localhost:8001/health)
[ ] Dashboard acessivel no navegador
[ ] DNS guard.flactech.com.br resolve para 147.93.7.251
[ ] HTTPS funcionando (certificado Let's Encrypt)
[ ] RTMP configurado com dominio no dashboard
[ ] Cameras online e transmitindo
[ ] Gravacoes sendo salvas
[ ] Deteccao de movimento funcionando
[ ] Reconhecimento facial funcionando
[ ] Webhook de deploy configurado e testado
[ ] Banco migrado (usuarios, cameras, gravacoes, embeddings)
[ ] S3 configurado (opcional — ver docs/SETUP_S3_CONTABO.md)
[ ] Monitoramento mostrando dados (pagina /monitor)
```

### Testar fluxo completo

```bash
# 1. Verificar containers
docker compose ps

# 2. Monitor completo
curl -s -H "Authorization: Bearer TOKEN" http://localhost:8000/api/monitor/stats | python3 -m json.tool

# 3. Listar cameras
curl -s -H "Authorization: Bearer TOKEN" http://localhost:8000/api/cameras | python3 -m json.tool

# 4. Webhook
curl http://localhost:9000/status
```

---

## Fase 10 — Desligar servidor antigo

Depois que TUDO estiver validado no novo servidor:

1. Verificar que nenhuma camera aponta para o IP antigo
2. Manter o servidor antigo ligado por 48h como backup
3. Fazer backup final do banco se necessario
4. Desativar/cancelar o servidor antigo no painel Contabo

---

## Resumo de enderecos

| Servico | Endereco |
|---------|----------|
| SSH | `root@147.93.7.251` |
| VNC | `144.126.149.10:63315` |
| Dashboard | `https://guard.flactech.com.br` |
| API | `https://guard.flactech.com.br/api` |
| RTMP (cameras) | `rtmp://guard.flactech.com.br:1935/live/<key>` |
| HLS (playback) | `https://guard.flactech.com.br/hls/<key>/index.m3u8` |
| Webhook | `http://147.93.7.251:9000/webhook` |

---

## Troubleshooting

### Camera nao conecta no RTMP
```bash
# Verificar se porta 1935 esta ouvindo
ss -tlnp | grep 1935

# Verificar firewall
sudo ufw status | grep 1935

# Testar de fora
nc -zv 147.93.7.251 1935
```

### Dashboard nao abre
```bash
# Ver logs
docker compose logs dashboard --tail=50
docker compose logs api --tail=50

# Verificar se o container esta rodando
docker compose ps dashboard
```

### Banco de dados nao conecta
```bash
# Ver logs do postgres
docker compose logs db --tail=50

# Verificar volume
docker volume inspect flac-guard_pgdata
```

### Face service nao carrega modelo
```bash
# Demora ~60-90s para carregar, verificar logs
docker compose logs face-service --tail=50 -f

# Verificar memoria disponivel (precisa de ~2GB)
free -h
```
