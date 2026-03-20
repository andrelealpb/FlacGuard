# Checklist de Upgrade — VPS Contabo (In-Place)

**Servidor:** Cloud VPS 20 NVMe — IP `147.93.7.251` (Carlstadt, US East)
**Tipo:** Upgrade in-place (mesmo servidor, mesmo IP)
**De:** Cloud VPS 10 NVMe (4 cores, 8GB RAM, 75GB NVMe)
**Para:** Cloud VPS 20 NVMe (6 cores, 12GB RAM, 100GB NVMe)
**OS:** Ubuntu 24.04
**VNC:** `144.126.149.10:63315`

> **Nota:** Como o endereco do servidor nao muda, as cameras, DNS e webhooks
> continuam funcionando sem nenhuma alteracao.

---

## Fase 1 — Antes do upgrade (no painel Contabo)

### 1.1 Fazer backup do banco

```bash
ssh root@147.93.7.251
cd /opt/FlacGuard

# Backup do banco
docker compose exec db pg_dump -U flac_guard flac_guard > /opt/FlacGuard/backup-pre-upgrade.sql

# Verificar tamanho
ls -lh backup-pre-upgrade.sql

# Verificar volumes Docker (serao preservados)
docker volume ls | grep flac-guard
```

### 1.2 Realizar o upgrade no painel

1. Acessar painel Contabo → VPS → Cloud VPS 10 NVMe (147.93.7.251)
2. Clicar "Upgrade" → Cloud VPS 20 NVMe ($10.75/mes)
3. Aguardar (o VPS sera reiniciado automaticamente)

---

## Fase 2 — Apos o upgrade

### 2.1 Verificar acesso

```bash
ssh root@147.93.7.251

# Verificar novos recursos
nproc           # Deve mostrar 6
free -h         # Deve mostrar ~12GB
df -h /         # Verificar espaco em disco
```

### 2.2 Expandir particao do disco (se necessario)

A Contabo pode precisar de expansao manual do disco:

```bash
# Ver situacao atual
lsblk
df -h

# Expandir (geralmente /dev/vda1 ou /dev/sda1)
sudo growpart /dev/vda 1
sudo resize2fs /dev/vda1

# Verificar
df -h
# Deve mostrar ~100GB agora
```

Se usar XFS ao inves de ext4:
```bash
sudo xfs_growfs /
```

### 2.3 Limpar Docker (liberar espaco)

```bash
# Parar servicos
cd /opt/FlacGuard
docker compose down

# Limpar imagens, containers e caches antigos
docker system prune -a --filter "until=72h"
docker builder prune -a

# Verificar espaco recuperado
df -h /
# Deve liberar ~15-20GB
```

### 2.4 Subir servicos novamente

```bash
cd /opt/FlacGuard
docker compose up -d

# Aguardar ~60-90s para o face-service carregar modelos
docker compose ps
```

### 2.5 Restaurar banco (se volumes foram perdidos)

Se os volumes Docker forem preservados (cenario normal), o banco ja esta intacto.
Se por algum motivo os volumes foram perdidos:

```bash
# Recriar volumes
docker volume create flac-guard_pgdata
docker volume create flac-guard_hls_data
docker volume create flac-guard_recordings

# Subir apenas o banco
docker compose up -d db
sleep 5

# Restaurar backup
docker compose exec -T db psql -U flac_guard flac_guard < /opt/FlacGuard/backup-pre-upgrade.sql

# Rodar migrations (para aplicar as novas, como multi-tenant e S3)
docker compose exec api node src/db/migrate.js

# Subir todos os servicos
docker compose up -d
```

---

## Fase 3 — Validacao pos-upgrade

### Checklist

```
[ ] SSH funcionando (ssh root@147.93.7.251)
[ ] CPU: 6 cores (nproc)
[ ] RAM: ~12GB (free -h)
[ ] Disco: ~100GB NVMe (df -h /)
[ ] Todos os 5 containers up (docker compose ps)
[ ] API health OK (curl localhost:8000/health)
[ ] Face service com modelo carregado (curl localhost:8001/health)
[ ] Dashboard acessivel (https://guard.flactech.com.br)
[ ] Cameras online e transmitindo
[ ] Gravacoes sendo salvas
[ ] Deteccao de movimento funcionando
[ ] Reconhecimento facial funcionando
[ ] Webhook de deploy funcionando (curl localhost:9000/status)
[ ] Monitoramento mostrando dados (/monitor)
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

## Resumo de enderecos (nao mudaram)

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
