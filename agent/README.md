# Flac Guard — Agent (Pi Zero 2 W)

Agent para câmeras **IC3/IC5 legadas** (~23 câmeras) que não possuem RTMP nativo.

O Pi Zero 2 W fica na mesma rede local da câmera e faz a tradução RTSP → RTMP,
enviando o stream para o servidor cloud.

## Hardware

- **Raspberry Pi Zero 2 W** (~R$ 130)
- Cartão microSD 16GB
- Fonte de alimentação 5V/2.5A
- Raspberry Pi OS Lite (sem desktop)

## Instalação

```bash
# No Pi Zero, via SSH
curl -sSL https://raw.githubusercontent.com/andrelealpb/FlacGuard/main/agent/install.sh | bash
```

Ou manualmente:

```bash
sudo apt update && sudo apt install -y ffmpeg
sudo cp flac-guard-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable flac-guard-agent
sudo systemctl start flac-guard-agent
```

## Configuração

Edite `/etc/flac-guard-agent.conf`:

```
CAMERA_IP=192.168.1.100
CAMERA_USER=admin
CAMERA_PASS=CHAVE_6_CHARS
RTSP_PORT=554
SERVER_URL=rtmp://SEU_SERVIDOR:1935/live
STREAM_KEY=sua_stream_key_aqui
```

## Verificação

```bash
# Status do serviço
sudo systemctl status flac-guard-agent

# Logs em tempo real
journalctl -u flac-guard-agent -f
```
