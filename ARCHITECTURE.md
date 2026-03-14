# HappyDo Guard — Arquitetura do Sistema

> Sistema centralizado de vídeo monitoramento para mercadinhos autônomos da Happydo Mercadinhos.
> Versão 2.3 | Março 2026 | **Fase 1 Concluída**

---

## 1. Visão Geral do Projeto

Este documento descreve a arquitetura técnica definitiva para o sistema centralizado de vídeo monitoramento da Happydo Mercadinhos, integrando aproximadamente 80 câmeras Wi-Fi da linha MIBO Intelbras distribuídas em 60-80 Pontos de Venda (PDVs), com 1-2 câmeras por PDV, na região de João Pessoa, Paraíba.

Os PDVs são **mercadinhos autônomos de autoatendimento** instalados em condomínios e empresas. O monitoramento por vídeo é essencial para prevenção e combate a furtos, identificação de ações suspeitas, contagem remota de produtos e acompanhamento das visitas dos repositores. A integração com outros sistemas (como o HappyDoPulse) é fundamental para cruzar dados de vídeo com eventos operacionais.

A arquitetura é baseada no protocolo RTMP (Real-Time Messaging Protocol), onde as próprias câmeras enviam o stream de vídeo diretamente para um servidor na cloud, eliminando a necessidade de hardware local na grande maioria dos PDVs e dispensando qualquer configuração nos roteadores das redes locais.

### 1.1 Objetivos

- **Monitoramento ao vivo centralizado:** visualizar qualquer câmera de qualquer PDV em tempo real via interface web.
- **Gravação contínua:** armazenar vídeo 24/7 com retenção configurável por PDV.
- **Acesso a gravações:** buscar e reproduzir gravações por data/hora, câmera e PDV.
- **Busca por momento exato:** API para que outros softwares (HappyDoPulse) solicitem o vídeo de um momento específico (ex: horário de chegada do repositor).
- **Prevenção de furtos:** base para detecção de ações suspeitas, contagem de produtos e análise comportamental via IA.
- **Zero hardware nos PDVs:** eliminar necessidade de equipamento adicional onde possível.
- **Sem acesso a roteadores:** funcionar sem port-forwarding, DDNS ou configuração de rede.
- **Escalabilidade:** arquitetura que suporte crescimento de 80 para 200+ câmeras.

### 1.2 Restrições e Premissas

- Cada PDV possui internet própria com IP dinâmico.
- **Não há acesso aos roteadores** dos PDVs (redes de condomínios/empresas).
- Solução deve funcionar apenas com conexões de saída (outbound).
- 1-2 câmeras por PDV (podendo chegar a 3 no futuro).
- Câmeras MIBO conectadas via Wi-Fi 2.4 GHz.
- Hospedagem em cloud (VPS).
- **Todo o desenvolvimento e infraestrutura 100% online/cloud.**

### 1.3 Decisão: RTMP vs RTSP

O RTSP é tecnicamente superior para vídeo de câmeras (menor latência, controle bidirecional, padrão da indústria CFTV). Porém, RTSP funciona como "pull" — o servidor precisa alcançar a câmera, o que exige port-forwarding no roteador. Como **não temos acesso aos roteadores**, o RTMP é a única opção viável: a câmera "empurra" o stream para fora (outbound), funcionando em qualquer rede, inclusive atrás de CGNAT.

No trecho entre o Pi Zero e as câmeras IC, o RTSP é usado localmente (mesma rede), e o Pi converte para RTMP outbound — usando o melhor de cada protocolo onde é possível.

### 1.4 Decisão: Nginx-RTMP + Custom vs Shinobi

O Shinobi foi avaliado e descartado. Ele foi projetado para puxar streams via RTSP (pull), não para receber RTMP (push). A solução adotada é **Nginx-RTMP** como receptor de streams + **API/Dashboard customizados em Node.js/React**, com controle total sobre funcionalidades, API e integração.

> **Mudança em relação à v1.x:** As versões anteriores previam agentes locais (Raspberry Pi) em todos os PDVs com túneis VPN. A descoberta de que as câmeras iM suportam RTMP nativo, combinada com a impossibilidade de acessar roteadores, levou a uma arquitetura fundamentalmente diferente: RTMP-first, com hardware local apenas para as câmeras IC legadas.

---

## 2. Inventário de Câmeras

### 2.1 Distribuição por Modelo e Capacidade

| Modelo | Qtd aprox. | RTMP | RTSP | ONVIF | Estratégia |
|--------|-----------|------|------|-------|------------|
| iM3 C | ~20 | ✅ SIM | ✅ | ✅ | RTMP direto → Cloud |
| iM5 SC | ~25 | ✅ SIM (validado) | ✅ | ✅ | RTMP direto → Cloud |
| iMX | ~12 | ✅ SIM | ✅ | ✅ | RTMP direto → Cloud |
| IC3 | ~13 | ❌ NÃO | ✅ | ✅* | Pi Zero (RTSP→RTMP) |
| IC5 | ~10 | ❌ NÃO | ✅ | ✅* | Pi Zero (RTSP→RTMP) |
| **TOTAL** | **~80** | **~57 com RTMP** | **Todas** | | |

\* ONVIF nas IC3/IC5 disponível após atualização de firmware.

### 2.2 Configuração RTMP Validada (iM5 SC)

Validação realizada em campo em uma câmera iM5 SC (firmware 2.800.00IB01X.0.R.240927).

**Caminho no app:** Mibo Smart → Configurações → Mais → Redes → RTMP → Habilitar → Personalizado

**Campos:**
- **Stream:** Econômica (sub-stream) ou Principal (full HD)
- **Endereço:** IP ou domínio do servidor RTMP (ex: guard.happydo.com.br)
- **Porta:** Porta do serviço RTMP (padrão: 1935)
- **URL RTMP:** Caminho + stream key (ex: /live/pdv_dct_loja)

A câmera faz conexão outbound para `rtmp://Endereço:Porta/URL_RTMP`. Não requer abertura de portas, DDNS ou configuração no roteador.

### 2.3 Autenticação das Câmeras

- **RTSP (local):** admin / chave de acesso da etiqueta (6 caracteres alfanuméricos). Porta 554.
- **RTMP:** Sem autenticação adicional — segurança pela URL única (stream key).
- **Porta TCP Intelbras-1:** 37777.
- **Todas as câmeras já possuem cartão microSD** instalado (backup local).

---

## 3. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                     GRUPO 1 (~57 câmeras iM)                    │
│                                                                 │
│  [Câmera iM3/iM5/iMX] ──RTMP outbound──→ [Servidor Cloud]     │
│  (config via app Mibo Smart)              (Nginx-RTMP)          │
│  Zero hardware no PDV                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     GRUPO 2 (~23 câmeras IC)                    │
│                                                                 │
│  [Câmera IC] ──RTSP local──→ [Pi Zero 2W] ──RTMP outbound──→  │
│                               (FFmpeg)      [Mesmo servidor]    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     SERVIDOR CLOUD (VPS)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐     │
│  │ Nginx-RTMP   │→ │ Gravação     │→ │ API REST (Node.js)│     │
│  │              │  │ FFmpeg       │  │                   │     │
│  │ Recebe RTMP  │  │ segmentos    │  │ /api/cameras      │     │
│  │ de ~80 cam.  │  │ MP4/HLS     │  │ /api/recordings   │     │
│  └──────────────┘  │              │  │ /api/events       │     │
│                    │ PostgreSQL   │  │ /api/live         │     │
│  ┌──────────────┐  └──────────────┘  │ /api/snapshots    │     │
│  │ Dashboard    │                    │ /api/webhooks     │     │
│  │ Web (React)  │                    └───────────────────┘     │
│  └──────────────┘                                               │
│                    ┌──────────────┐                              │
│                    │ Módulo IA    │                              │
│                    │ (YOLO, Fase5)│                              │
│                    └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Grupo 1: Câmeras iM com RTMP Nativo (~57 câmeras)

- **Fluxo:** Câmera MIBO iM → RTMP outbound → Servidor RTMP Cloud → Gravação + Dashboard
- **Configuração:** uma vez via app Mibo Smart (~2 min/câmera)
- **Hardware no PDV:** nenhum
- **Configuração no roteador:** nenhuma

### 3.2 Grupo 2: Câmeras IC Legadas (~23 câmeras)

- **Fluxo:** Câmera IC → RTSP local → Pi Zero 2 W (FFmpeg) → RTMP outbound → Servidor Cloud
- **Comando:** `ffmpeg -i rtsp://admin:CHAVE@IP_LOCAL:554/live -c copy -f flv rtmp://servidor:1935/live/stream_key`
- **Hardware no PDV:** 1x Pi Zero 2 W (~R$ 150) + fonte + SD 16GB
- **Configuração no roteador:** nenhuma

### 3.3 Componentes do Servidor

| Componente | Tecnologia | Função |
|-----------|-----------|--------|
| Servidor RTMP | Nginx-RTMP | Recebe streams das câmeras |
| NVR / Gravação | Custom Node.js + FFmpeg | Gravação, playback, timeline |
| Banco de Dados | PostgreSQL | Metadados: câmeras, PDVs, eventos |
| Armazenamento | Disco local VPS + Object Storage | Gravações de vídeo |
| Proxy Reverso | Nginx + Let's Encrypt | HTTPS, autenticação |
| Dashboard Web | React | Mosaico ao vivo, busca de gravações |
| Monitoramento | Healthcheck custom + alertas | Detectar câmeras offline |

### 3.4 Dimensionamento

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| CPU | 8 vCPUs | 16 vCPUs |
| RAM | 16 GB | 32 GB |
| Armazenamento | 2 TB SSD (7 dias) | 4 TB SSD (14 dias) |
| Banda de entrada | 50 Mbps | 100+ Mbps |

---

## 4. Segurança

- Stream keys únicas por câmera, servidor rejeita keys não cadastradas.
- HTTPS obrigatório (Let's Encrypt). JWT com níveis: Admin, Operador, Visualizador.
- Firewall: 1935 (RTMP) + 443 (HTTPS) + 22 (SSH).
- LGPD: coleta justificada, retenção 7-14 dias, exclusão automática.

---

## 5. API de Integração

### 5.1 Endpoints

```
GET    /api/cameras                              # Listar câmeras com status
GET    /api/cameras/:id/live                     # URL do stream HLS/WebRTC
GET    /api/cameras/:id/recordings               # Listar gravações por período
GET    /api/cameras/:id/recording?timestamp=...  # Gravação por momento exato
GET    /api/cameras/:id/snapshot                 # Frame atual (JPEG)
GET    /api/cameras/:id/download                 # Download trecho MP4
GET    /api/pdvs                                 # Listar PDVs com câmeras
GET    /api/events                               # Eventos (movimento, offline, IA)
POST   /api/webhooks                             # Cadastrar webhooks
```

### 5.2 Busca por Momento Exato

```
GET /api/cameras/pdv42_im5sc/recording?timestamp=2026-03-10T14:32:00&duration=300
→ URL temporária para trecho MP4 de 5 minutos
```

### 5.3 Autenticação

- API Key (`X-API-Key`) para server-to-server (HappyDoPulse).
- JWT para dashboard web. Rate limit: 100 req/min.

---

## 6. Detecção Inteligente (IA) — Fase 5

Componente central para mercadinhos autônomos sem atendente.

- **Motor:** YOLO v8/v11. GPU cloud sob demanda.
- **Capacidades:** detecção de pessoas, ações suspeitas, contagem de produtos, heatmaps.
- **Pipeline:** NVR extrai frames → serviço IA processa → publica eventos na API.

---

## 7. Ambiente de Desenvolvimento

100% online. Claude Code via SSH no VPS. GitHub + GitHub Actions para CI/CD. PostgreSQL no VPS.

---

## 8. Custos

| | Valor |
|--|-------|
| **CAPEX total** | ~R$ 3.000 (Pi Zeros para ICs) |
| OPEX Fase 1 | ~R$ 30/mês |
| OPEX Rollout | ~R$ 100-150/mês |
| OPEX steady-state | ~R$ 150-300/mês |

**VPS por fase (Contabo):** VPS 10 (R$30) → VPS 20 (R$55) → Storage VPS 30 (R$100) → VPS 40 (R$150)

---

## 9. Plano de Implementação

### 9.1 Fase 1 — PoC ✅ CONCLUÍDA

| # | Ação | Status |
|---|------|--------|
| 1 | Provisionar VPS Contabo Cloud VPS 10 | ✅ |
| 2 | Deploy: docker compose up -d + migrations | ✅ |
| 3 | Criar admin | ✅ |
| 4 | Configurar iM5 SC (DCT LOJA) RTMP | ✅ |
| 5 | Configurar +2 câmeras teste | ✅ |
| 6 | Estabilidade 72h | ✅ |

### 9.2 Fase 2 — Completar Produto ⏳ PRÓXIMA

| # | Ação | Detalhe |
|---|------|---------|
| 1 | Implementar /snapshot e /download | FFmpeg (hoje 501) |
| 2 | HTTPS + guard.happydo.com.br | Let's Encrypt |
| 3 | Limpeza automática +14 dias | Cron LGPD |
| 4 | Seed PDVs e câmeras | Script via API |

### 9.3 Fase 3 — Piloto (5 PDVs)

| # | Ação | Detalhe |
|---|------|---------|
| 1 | Pi Zero para câmeras IC | Agent RTSP→RTMP |
| 2 | Alertas câmera offline | Webhooks → HappyDoPulse |
| 3 | Auth JWT no dashboard | Frontend sem token hoje |

### 9.4 Fase 4 — Rollout (~80 câmeras)

| # | Ação | Detalhe |
|---|------|---------|
| 1 | Monitoramento completo | Disco, CPU, câmeras |
| 2 | Upgrade VPS | Storage VPS 30 |
| 3 | Integração HappyDoPulse | API Key para app mobile |
| 4 | Config ~77 câmeras iM | 10-15/dia via app |
| 5 | Deploy Pi Zeros ICs | ~20 agentes |

### 9.5 Fase 5 — IA e Evolução

| # | Ação | Detalhe |
|---|------|---------|
| 1 | YOLO v8/v11 | Pessoas, ações suspeitas |
| 2 | Contagem de produtos | Inventário visual |
| 3 | Heatmaps e analytics | Dados por PDV |
| 4 | Módulo vídeo HappyDoPulse | Tela nativa no app |
| 5 | Investigar P2P TUTK/Kalay | Acesso remoto ao SD |
| 6 | Migrar IC → iM | Eliminar Pi Zeros |

---

## 10. Riscos

| Risco | Impacto | Mitigação | Prob. |
|-------|---------|-----------|-------|
| Intelbras remover RTMP em firmware | Alto | Travar firmware | Baixa |
| Queda de internet no PDV | Médio | SD grava local | Alta |
| Rede bloquear porta 1935 | Médio | Fallback 443/80 | Baixa |
| Sobrecarga servidor | Alto | Escalar VPS, sub-stream | Baixa |
| Pi Zero instável | Baixo | Watchdog + auto-restart | Média |

---

## 11. Estrutura do Repositório

```
happydo-guard/
├── ARCHITECTURE.md
├── README.md
├── docker-compose.yml
├── .github/workflows/deploy.yml
├── server/
│   ├── nginx-rtmp/nginx.conf
│   ├── api/src/ (Express + routes + services + db)
│   └── recorder/ (FFmpeg scripts)
├── dashboard/src/ (React)
├── agent/ (Pi Zero scripts + systemd)
└── docs/ (cameras.md, rtmp-setup.md, vps-setup.md)
```

---

## 12. Notas Técnicas

### P2P Intelbras (TUTK/Kalay)
Câmeras MIBO usam ThroughTek Kalay. Intelbras não fornece API/SDK para MIBO. Engenharia reversa viável (precedente Wyze/wyzecam) mas arriscada. Investigação na Fase 5.

### Apps Mibo
**Mibo** (IC3/IC5 legadas) e **Mibo Smart** (linha iM). RTMP está no Mibo Smart. APK antigo tem certificado CN=hikvision.

### Gravações no SD
- **iM:** permite desabilitar criptografia, backup pelo PC funciona.
- **IC:** gravações criptografadas, backup direto não funciona na IC3.
- SD = backup offline de último recurso.
