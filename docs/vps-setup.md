# Setup do VPS

Guia para provisionar e configurar o servidor cloud para o Flac Guard.

## Provedor recomendado: Contabo

| Fase | Plano | Specs | Custo/mês |
|------|-------|-------|-----------|
| PoC | Cloud VPS 10 | 4 vCPU, 8GB RAM, 75GB NVMe | ~R$ 30 |
| Piloto | Cloud VPS 20 | 6 vCPU, 16GB RAM, 150GB NVMe | ~R$ 55 |
| Rollout | Storage VPS 30 | 8 vCPU, 24GB RAM, 1TB SSD | ~R$ 100 |

Tráfego de entrada ilimitado. Upgrade sem migração.

## Instalação inicial

```bash
# 1. Atualizar sistema
sudo apt update && sudo apt upgrade -y

# 2. Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. Instalar Docker Compose
sudo apt install -y docker-compose-plugin

# 4. Clonar repositório
git clone https://github.com/andrelealpb/FlacGuard.git /opt/FlacGuard
cd /opt/FlacGuard

# 5. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com os valores de produção

# 6. Subir serviços
docker compose up -d

# 7. Rodar migrations
docker compose exec api node src/db/migrate.js
```

## Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 443/tcp   # HTTPS (dashboard)
sudo ufw allow 1935/tcp  # RTMP (câmeras)
sudo ufw enable
```

## HTTPS com Let's Encrypt

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d guard.flacguard.com.br
```

Configure o Nginx do dashboard para usar o certificado gerado.

## Monitoramento de disco

As gravações consomem espaço. Configure limpeza automática:

```bash
# Crontab: apagar gravações com mais de 14 dias, diariamente às 3h
0 3 * * * find /data/recordings -name "*.flv" -mtime +14 -delete
0 3 * * * find /data/recordings -name "*.mp4" -mtime +14 -delete
```
