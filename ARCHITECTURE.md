# HappyDo Guard — Arquitetura do Sistema

> Sistema centralizado de vídeo monitoramento para mercadinhos autônomos da Happydo Mercadinhos.
> Versão 2.4 | Março 2026 | **Fase 1 Concluída**

---

## 1. Visão Geral do Projeto

Este documento descreve a arquitetura técnica definitiva para o sistema centralizado de vídeo monitoramento da Happydo Mercadinhos, integrando aproximadamente 80 câmeras Wi-Fi da linha MIBO Intelbras distribuídas em 60-80 Pontos de Venda (PDVs), com 1-2 câmeras por PDV, na região de João Pessoa, Paraíba.

Os PDVs são **mercadinhos autônomos de autoatendimento** instalados em condomínios e empresas. O monitoramento por vídeo é essencial para prevenção e combate a furtos, identificação de ações suspeitas, contagem remota de produtos e acompanhamento das visitas dos repositores. A integração com outros sistemas (como o HappyDoPulse) é fundamental para cruzar dados de vídeo com eventos operacionais.

A arquitetura é baseada no protocolo RTMP (Real-Time Messaging Protocol), onde as próprias câmeras enviam o stream de vídeo diretamente para um servidor na cloud. **A gravação é seletiva: somente quando há movimento detectado**, reduzindo o armazenamento em ~80-90%.

### 1.1 Objetivos

- **Monitoramento ao vivo centralizado:** visualizar qualquer câmera de qualquer PDV em tempo real via interface web.
- **Gravação por movimento:** gravar apenas quando há atividade detectada, economizando ~80-90% do armazenamento.
- **Busca por momento exato:** API para que outros softwares (HappyDoPulse) solicitem o vídeo de um momento específico (ex: horário de chegada do repositor).
- **Prevenção de furtos:** base para detecção de ações suspeitas, contagem de produtos e análise comportamental via IA.
- **Zero hardware nos PDVs:** eliminar necessidade de equipamento adicional onde possível.
- **Sem acesso a roteadores:** funcionar sem port-forwarding, DDNS ou configuração de rede.
- **Escalabilidade:** arquitetura que suporte crescimento de 80 para 200+ câmeras.
- **100% cloud:** todo desenvolvimento e infraestrutura online.

### 1.2 Restrições e Premissas

- Cada PDV possui internet própria com IP dinâmico.
- **Não há acesso aos roteadores** dos PDVs (redes de condomínios/empresas).
- Solução deve funcionar apenas com conexões de saída (outbound).
- 1-2 câmeras por PDV (podendo chegar a 3 no futuro).
- Câmeras MIBO conectadas via Wi-Fi 2.4 GHz.
- Todas as câmeras já possuem cartão microSD instalado (backup local).

### 1.3 Decisões Técnicas

**RTMP vs RTSP:** RTSP é superior tecnicamente, mas exige port-forwarding. Como não temos acesso aos roteadores, RTMP (outbound/push) é a única opção viável. No Pi Zero, RTSP é usado localmente e convertido para RTMP.

**Nginx-RTMP + Custom vs Shinobi:** Shinobi foi projetado para RTSP pull, não RTMP push. Solução adotada: Nginx-RTMP + API/Dashboard custom em Node.js/React.

**Gravação contínua vs por movimento:** Gravação contínua consumiria ~4.9 TB em 14 dias. Gravação por movimento reduz para ~500 GB-1 TB (~80-90% de economia). Adotada gravação por movimento com pre-buffer e post-buffer.

---

## 2. Inventário de Câmeras

| Modelo | Qtd | RTMP | RTSP | Estratégia |
|--------|-----|------|------|------------|
| iM3 C | ~20 | ✅ | ✅ | RTMP direto → Cloud |
| iM5 SC | ~25 | ✅ (validado) | ✅ | RTMP direto → Cloud |
| iMX | ~12 | ✅ | ✅ | RTMP direto → Cloud |
| IC3 | ~13 | ❌ | ✅ | Pi Zero (RTSP→RTMP) |
| IC5 | ~10 | ❌ | ✅ | Pi Zero (RTSP→RTMP) |
| **TOTAL** | **~80** | **~57** | **Todas** | |

### Configuração RTMP (validada em iM5 SC)

App Mibo Smart → Configurações → Mais → Redes → RTMP → Habilitar → Personalizado

- **Stream:** Econômica ou Principal
- **Endereço:** IP ou domínio do servidor
- **Porta:** 1935
- **URL RTMP:** /live/stream_key_unica

### Autenticação

- **RTSP local:** admin / chave da etiqueta (6 chars), porta 554
- **RTMP:** segurança pela stream key única
- **Intelbras-1:** porta 37777

---

## 3. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│  GRUPO 1 (~57 câmeras iM) → RTMP outbound → Servidor Cloud     │
│  GRUPO 2 (~23 câmeras IC) → RTSP → Pi Zero → RTMP → Servidor  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     SERVIDOR CLOUD (VPS)                         │
│                                                                 │
│  ┌──────────────┐     ┌─────────────────┐                      │
│  │ Nginx-RTMP   │────→│ HLS Live        │──→ Dashboard/API     │
│  │ (recebe ~80  │     │ (sempre ativo)  │                      │
│  │  streams)    │     └─────────────────┘                      │
│  └──────┬───────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐     ┌─────────────────┐                      │
│  │ Motion       │────→│ Gravador FFmpeg  │──→ Arquivos MP4     │
│  │ Detector     │     │ (só quando há   │    (só movimento)    │
│  │ (Node.js)    │     │  movimento)     │                      │
│  │              │     └─────────────────┘                      │
│  │ Analisa 1    │                                               │
│  │ frame/2-3s   │     ┌─────────────────┐                      │
│  │ por câmera   │────→│ API REST        │──→ Eventos,          │
│  └──────────────┘     │ (Node.js)       │    Webhooks,         │
│                       │                 │    Busca por         │
│  ┌──────────────┐     │                 │    timestamp         │
│  │ PostgreSQL   │◄───→│                 │                      │
│  └──────────────┘     └─────────────────┘                      │
│                                                                 │
│  ┌──────────────┐     ┌─────────────────┐                      │
│  │ Dashboard    │     │ Módulo IA       │                      │
│  │ React        │     │ (YOLO, Fase 5)  │                      │
│  └──────────────┘     └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Componentes do Servidor

| Componente | Tecnologia | Função |
|-----------|-----------|--------|
| Servidor RTMP | Nginx-RTMP | Recebe streams, serve HLS ao vivo |
| **Motion Detector** | **Node.js + análise de frames** | **Detecta movimento, aciona gravação** |
| Gravador | FFmpeg (acionado por evento) | Grava segmentos MP4 sob demanda |
| API Backend | Node.js + Express | Busca, playback, eventos, webhooks |
| Banco de Dados | PostgreSQL | Metadados: câmeras, PDVs, eventos |
| Dashboard Web | React | Mosaico ao vivo, busca de gravações |
| Monitoramento | Healthcheck custom | Câmeras offline, disco, CPU |

### 3.2 Estratégia de Gravação: Somente por Movimento

O sistema **NÃO grava continuamente**. O stream RTMP chega 24/7 (necessário para o live), mas a gravação em disco só ocorre quando há movimento.

#### Abordagem: Node.js + Análise de Frames

- **Análise periódica:** extrai 1 frame a cada 2-3 segundos do HLS de cada câmera.
- **Comparação de frames:** calcula diferença de pixels (ou SSIM) entre frames consecutivos.
- **Threshold configurável:** sensibilidade ajustável por câmera (evitar falsos positivos).
- **Pre-buffer:** mantém últimos 10 segundos em memória para não perder o início do evento.
- **Post-buffer:** continua gravando 30 segundos após último movimento detectado.
- **Evolução para IA:** o mesmo pipeline será usado na Fase 5 para YOLO.

#### Fluxo de um Evento de Movimento

1. Stream RTMP chega ao Nginx → HLS ao vivo servido normalmente (sem gravação).
2. Motion Detector extrai frame do HLS, compara com frame anterior.
3. Diferença > threshold → **MOVIMENTO DETECTADO**.
4. Inicia gravação FFmpeg (incluindo pre-buffer de 10s).
5. Enquanto houver movimento, continua gravando.
6. 30 segundos sem movimento → **ENCERRA gravação**.
7. Evento registrado na API: timestamp início/fim, câmera, PDV, thumbnail.
8. Gravação MP4 disponível para busca e download via API.

#### Economia de Armazenamento

| Métrica | Contínua (24/7) | Por Movimento |
|---------|----------------|---------------|
| Horas gravadas/dia (80 câm.) | 1.920 h | ~160-240 h |
| Armazenamento/dia (sub-stream) | ~350 GB | **~35-70 GB** |
| 14 dias retenção | ~4.9 TB | **~500 GB - 1 TB** |
| VPS necessário | Storage VPS 30+ | **Cloud VPS 20** |
| Custo VPS | R$ 100-150/mês | **R$ 55/mês** |
| **Economia** | — | **~80-90%** |

### 3.3 Dimensionamento

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| CPU | 8 vCPUs | 16 vCPUs |
| RAM | 16 GB | 32 GB |
| Armazenamento | 500 GB SSD (14 dias mov.) | 1 TB SSD (margem) |
| Banda de entrada | 50 Mbps | 100+ Mbps |
| Custo estimado | R$ 55/mês (Contabo VPS 20) | R$ 100/mês (Storage 30) |

---

## 4. Segurança

- Stream keys únicas por câmera, servidor rejeita keys não cadastradas.
- HTTPS obrigatório (Let's Encrypt). JWT com níveis: Admin, Operador, Visualizador.
- Firewall: 1935 (RTMP) + 443 (HTTPS) + 22 (SSH).
- LGPD: coleta justificada, retenção 7-14 dias, exclusão automática.

---

## 5. API de Integração

### Endpoints

```
GET    /api/cameras                              # Listar câmeras com status
GET    /api/cameras/:id/live                     # URL do stream HLS
GET    /api/cameras/:id/recordings               # Listar gravações por período
GET    /api/cameras/:id/recording?timestamp=...  # Gravação por momento exato
GET    /api/cameras/:id/snapshot                 # Frame atual (JPEG)
GET    /api/cameras/:id/download                 # Download trecho MP4
GET    /api/pdvs                                 # Listar PDVs com câmeras
GET    /api/events                               # Eventos (movimento, offline, IA)
POST   /api/webhooks                             # Cadastrar webhooks
```

### Busca por Momento Exato

```
GET /api/cameras/pdv42_im5sc/recording?timestamp=2026-03-10T14:32:00&duration=300
→ URL temporária para trecho MP4 de 5 minutos
```

### Autenticação

- API Key (`X-API-Key`) para server-to-server (HappyDoPulse).
- JWT para dashboard web. Rate limit: 100 req/min.

---

## 6. Detecção Inteligente (IA) — Fase 5

Componente central para mercadinhos autônomos sem atendente.

- **Motor:** YOLO v8/v11. GPU cloud sob demanda.
- **Capacidades:** detecção de pessoas, ações suspeitas, contagem de produtos, heatmaps.
- **Pipeline:** mesmo Motion Detector da Fase 2, evoluído para rodar YOLO nos frames.
- **Custo:** GPU T4 ~R$ 150-200/mês em uso contínuo. Recomenda-se sob demanda.

---

## 7. Ambiente de Desenvolvimento

100% online. Claude Code via SSH no VPS. GitHub (`happydo-guard`) + GitHub Actions para CI/CD. PostgreSQL no VPS.

---

## 8. Custos

| | Valor |
|--|-------|
| **CAPEX total** | ~R$ 3.000 (Pi Zeros para ICs) |
| OPEX Fase 1-2 | ~R$ 30-55/mês |
| OPEX Rollout | ~R$ 55-100/mês |
| OPEX steady-state | ~R$ 55-150/mês |

**VPS por fase (Contabo):** VPS 10 (R$30) → VPS 20 (R$55) → Storage VPS 30 (R$100)

**Comparativo:**
- Mibo Cloud: R$ 1.200-2.400/mês
- Monuv: R$ 1.600-4.000/mês
- NVR físico por PDV: R$ 105.000 CAPEX
- **HappyDo Guard: R$ 3.000 CAPEX + R$ 55-150/mês**

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
| 1 | **Implementar Motion Detector** | Node.js + análise de frames do HLS |
| 2 | **Gravador por evento (FFmpeg)** | Pre-buffer 10s, post-buffer 30s, MP4 |
| 3 | **Registrar eventos de movimento na API** | Timestamp início/fim, câmera, PDV, thumbnail |
| 4 | Implementar /snapshot e /download | FFmpeg (hoje 501) |
| 5 | HTTPS + guard.happydo.com.br | Let's Encrypt |
| 6 | Limpeza automática +14 dias | Cron LGPD |
| 7 | Seed PDVs e câmeras | Script via API |
| 8 | Config sensibilidade por câmera | Threshold ajustável, zonas de exclusão |

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
| 2 | Upgrade VPS | Cloud VPS 20 ou Storage 30 |
| 3 | Integração HappyDoPulse | API Key para app mobile |
| 4 | Config ~77 câmeras iM | 10-15/dia via app |
| 5 | Deploy Pi Zeros ICs | ~20 agentes |

### 9.5 Fase 5 — IA e Evolução

| # | Ação | Detalhe |
|---|------|---------|
| 1 | Evoluir Motion Detector → YOLO | Pessoas, ações suspeitas |
| 2 | Contagem de produtos | Inventário visual |
| 3 | Heatmaps e analytics | Dados por PDV |
| 4 | Módulo vídeo HappyDoPulse | Tela nativa no app |
| 5 | Investigar P2P TUTK/Kalay | Acesso remoto ao SD |
| 6 | Migrar IC → iM | Eliminar Pi Zeros |

### Cronograma

| Fase | Duração | Status |
|------|---------|--------|
| 1. PoC | 1-2 semanas | ✅ CONCLUÍDA |
| 2. Produto | 3-4 semanas | ⏳ Próxima |
| 3. Piloto | 2-3 semanas | Pendente |
| 4. Rollout | 3-4 semanas | Pendente |
| 5. IA | Contínuo | Futuro |

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Intelbras remover RTMP em firmware | Alto | Travar firmware |
| Queda de internet no PDV | Médio | SD grava local |
| Rede bloquear porta 1935 | Médio | Fallback 443/80 |
| Sobrecarga servidor | Alto | Escalar VPS, sub-stream |
| Pi Zero instável | Baixo | Watchdog + auto-restart |
| Falsos positivos no Motion Detector | Médio | Threshold por câmera, zonas de exclusão |

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
│   ├── api/src/
│   │   ├── index.js
│   │   ├── routes/ (cameras, recordings, events, webhooks)
│   │   ├── services/
│   │   │   ├── rtmp.js
│   │   │   ├── motion-detector.js   ← NOVO (Fase 2)
│   │   │   ├── recorder.js          ← NOVO (Fase 2)
│   │   │   ├── recording.js
│   │   │   └── health.js
│   │   └── db/ (schema, migrations)
│   └── recorder/ (FFmpeg scripts)
├── dashboard/src/ (React)
├── agent/ (Pi Zero: install.sh, rtsp-to-rtmp.sh, systemd)
└── docs/ (cameras.md, rtmp-setup.md, vps-setup.md)
```

---

## 12. Notas Técnicas

### P2P Intelbras (TUTK/Kalay)
Câmeras MIBO usam ThroughTek Kalay. Intelbras não fornece API/SDK para MIBO. Engenharia reversa viável (precedente Wyze). Investigação na Fase 5.

### Apps Mibo
**Mibo** (IC legadas) e **Mibo Smart** (linha iM). RTMP está no Mibo Smart.

### Gravações no SD
- **iM:** permite desabilitar criptografia, backup pelo PC funciona.
- **IC:** gravações criptografadas, backup direto não funciona na IC3.
- SD = backup offline de último recurso.

### Sobre o Motion Detector
O Motion Detector da Fase 2 é projetado para evoluir para IA na Fase 5. O pipeline de extração e análise de frames é o mesmo — na Fase 2 usa comparação de pixels, na Fase 5 roda YOLO. Essa decisão de design é intencional: investimento que se compõe.
