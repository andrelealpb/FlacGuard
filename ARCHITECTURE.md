# HappyDo Guard — Arquitetura do Sistema

> Versão 2.8 | Março 2026 | **Fase 1 Concluída**

---

## 1. Visão Geral

Happydo opera 60-80 mercadinhos autônomos de autoatendimento em João Pessoa/PB. Cada PDV possui 1-2 câmeras MIBO Intelbras (~80 total) e um dispositivo Android.

O sistema combina **câmeras MIBO** (teto, visão geral) + **app Guard Cam** (frontal, rostos) nos dispositivos Android já existentes, alimentando um servidor cloud com gravação por movimento, reconhecimento facial, busca cruzada por timestamp e alertas via webhook.

**Armazenamento unificado:** para o servidor, MIBO e Guard Cam são idênticos — mesmo pipeline, mesma gravação, mesmos endpoints.

### Objetivos

- Live centralizado (MIBO + Guard Cam)
- Gravação por movimento (~80-90% economia)
- Reconhecimento facial (suspeitos, repositores, watchlist)
- Busca cruzada por timestamp (mosaico sincronizado)
- Contagem de visitantes distintos/dia
- Zero hardware extra — dispositivos Android existentes
- 100% cloud (desenvolvimento + infraestrutura)

### Decisões

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Protocolo | RTMP push | Sem acesso ao roteador |
| NVR | Nginx-RTMP + Custom | Controle total |
| Gravação | Por movimento | ~80-90% economia |
| Face recognition | InsightFace (Fase 2) | Qualidade + open source |
| Retenção | Por câmera | Watchlist permanente |
| Webhooks | Genéricos | Qualquer destino HTTP |
| Guard Cam | **Kotlin nativo** | Ultra-leve (~30MB), build via CI/CD |
| CI/CD Android | **GitHub Actions** | Sem Android Studio local |

---

## 2. Inventário

### Câmeras MIBO

| Modelo | Qtd | RTMP | Estratégia |
|--------|-----|------|------------|
| iM3 C | ~20 | ✅ | RTMP direto |
| iM5 SC | ~25 | ✅ (validado) | RTMP direto |
| iMX | ~12 | ✅ | RTMP direto |
| IC3 | ~13 | ❌ | Pi Zero (RTSP→RTMP) |
| IC5 | ~10 | ❌ | Pi Zero (RTSP→RTMP) |

### Dispositivos Android

| Dispositivo | Câmera | USB | RAM | Android |
|------------|--------|-----|-----|---------|
| PIPO X9R | ❌ | ✅ 4x USB | 2GB | 4.4-5.1 |
| Sunmi D2 Mini | ⚠️ Versão scan | ✅ | 2GB | 8.1 |
| Lenovo Tab 10.1" | ✅ Frontal | ✅ OTG | 4GB | 14 |

---

## 3. Arquitetura

```
POR PDV:
  [Câmera MIBO] ──RTMP──→ Servidor    (teto)
  [Guard Cam]   ──RTMP──→ Servidor    (frontal)
  → Pipeline 100% idêntico

SERVIDOR CLOUD:
  Nginx-RTMP → HLS Live → Dashboard/API
       │
  Pipeline Unificado (cada 2-3s):
  ├── 1. Movimento → gravar?
  ├── 2. Rostos → embedding 512D → pgvector
  └── 3. Watchlist → match >85% → webhook
       │                    │
  FFmpeg Recorder      PostgreSQL + pgvector
  (MP4 só movimento)   (embeddings, metadados)
       │
  API REST ←→ Dashboard React
  ├── Busca cruzada por timestamp
  └── Webhooks → qualquer destino
```

### Retenção

| Tipo | Retenção |
|------|----------|
| Gravações + embeddings | Configurável por câmera (padrão 7-14 dias) |
| **Embeddings watchlist** | **Permanentes** |
| Audit log | 90 dias |

---

## 4. HappyDo Guard Cam (App Android)

### 4.1 Visão Geral

App Android nativo Kotlin, ultra-leve, desenvolvido como parte do projeto. Captura vídeo da câmera integrada ou webcam USB → RTMP push → servidor. **Zero processamento de IA local.**

### 4.2 Stack

| Componente | Tecnologia |
|-----------|-----------|
| Linguagem | **Kotlin nativo** |
| Câmera integrada | CameraX (Jetpack) |
| Webcam USB | UVCCamera (libusb/UVC) |
| Encoder | MediaCodec (H.264 hardware) |
| RTMP | rtmp-rtsp-stream-client-java |
| Background | Foreground Service + WakeLock |
| Config | QR Code + API pull |
| Build | **GitHub Actions (CI/CD cloud)** |

### 4.3 Funcionalidades

- Detecção automática: câmera integrada → webcam USB (fallback)
- RTMP push: 720p, 10-15fps, H.264 hardware
- Auto-start on boot + auto-reconnect + watchdog
- Config via QR code ou tela de setup única
- LED discreto (verde/vermelho)
- Background service — tela livre para outros apps
- Heartbeat 60s + config remota via API

### 4.4 Performance

| Métrica | Alvo |
|---------|------|
| RAM | < 30 MB |
| CPU | < 2% |
| Android mínimo | 5.0 (API 21) |
| Boot → streaming | < 15s |

### 4.5 Pipeline de Build (CI/CD)

O app é desenvolvido no Claude Code e compilado na cloud via GitHub Actions. Sem Android Studio local.

```
1. Escrever código Kotlin (Claude Code SSH)
2. Push → branch guard-cam/* no GitHub
3. GitHub Actions dispara:
   ├── Setup JDK 17 + Android SDK + Gradle cache
   ├── ./gradlew assembleRelease
   ├── Assinar APK
   └── Upload artifact (ou GitHub Release)
4. Distribuir APK nos dispositivos
```

### 4.6 Distribuição

| Método | Detalhe |
|--------|---------|
| ADB via rede | `adb connect IP:5555` + `adb install` (mesmo Wi-Fi) |
| Download HTTP | App busca atualização em `guard.happydo.com.br/apk/latest` |
| Pendrive/SD | Copiar APK, instalar local |

Sem Google Play. Distribuição interna (sideload). PIPO, Sunmi e Lenovo permitem instalação de fontes externas.

### 4.7 Configuração

```json
{
  "server": "guard.happydo.com.br",
  "port": 1935,
  "stream_key": "pdv_dct_loja_facecam",
  "camera_source": "auto",
  "resolution": "720p",
  "fps": 15
}
```

---

## 5. Busca Cruzada por Timestamp

### Conceito

A partir de um momento em qualquer câmera, buscar o mesmo instante em todas as outras. Dashboard exibe como mosaico sincronizado.

### Endpoints

| Escopo | Endpoint | Retorno |
|--------|----------|---------|
| Mesma câmera | `GET /api/cameras/:id/recording?timestamp=T&duration=300` | Trecho MP4 |
| Mesmo PDV | `GET /api/pdvs/:id/recordings?timestamp=T` | MIBO + Guard Cam |
| Todos PDVs | `GET /api/recordings/cross-search?timestamp=T&range=300` | Tudo ±5min |

### Caso de Uso

1. Suspeito na Guard Cam do PDV 12 às 14:32
2. Clica → busca cruzada automática:
   - MIBO PDV 12 → o que a pessoa fez
   - Guard Cam outros PDVs → se visitou mais lojas
3. Mosaico sincronizado no Dashboard

### Integração com Face Search

```
Upload foto → embedding → pgvector busca → aparições com timestamps
  → cada resultado tem link de busca cruzada
  → Dashboard mostra mosaico daquele instante
```

---

## 6. Reconhecimento Facial (Fase 2)

Pipeline unificado por frame (MIBO e Guard Cam, sem distinção):
1. Movimento → gravar?
2. Rostos (InsightFace) → embedding 512D → pgvector
3. Watchlist → match >85% → webhook

Streams Guard Cam priorizados (ângulo frontal = embeddings superiores).

### Casos de Uso

| Caso | Descrição |
|------|-----------|
| Buscar suspeito | Upload foto → PDVs e horários → busca cruzada |
| Confirmar repositor | Upload foto → chegada/saída por PDV |
| Alerta watchlist | Rosto → webhook configurável |
| Visitantes/dia | Pessoas distintas por PDV |

### LGPD

- Legítimo interesse. Embeddings não reversíveis
- Retenção por câmera. **Watchlist permanente**
- Acesso: Admin. Audit log de toda busca

---

## 7. API Completa

```
# Câmeras (MIBO + Guard Cam, unificado)
GET    /api/cameras
GET    /api/cameras/:id/live
GET    /api/cameras/:id/recordings
GET    /api/cameras/:id/recording?timestamp=T&duration=300
GET    /api/cameras/:id/snapshot
GET    /api/cameras/:id/download

# PDVs
GET    /api/pdvs
GET    /api/pdvs/:id/visitors
GET    /api/pdvs/:id/recordings?timestamp=T

# Busca Cruzada
GET    /api/recordings/cross-search?timestamp=T&range=300

# Face Recognition
POST   /api/faces/search
GET    /api/faces/watchlist
POST   /api/faces/watchlist
DELETE /api/faces/watchlist/:id

# Guard Cam
GET    /api/guard-cam/config/:device_id
POST   /api/guard-cam/heartbeat

# Eventos e Webhooks
GET    /api/events
POST   /api/webhooks
```

Auth: API Key (server-to-server), JWT (dashboard), device token (Guard Cam).

---

## 8. Ambiente de Desenvolvimento

100% cloud. Sem ferramentas locais.

| Função | Ferramenta |
|--------|-----------|
| IDE | Claude Code (SSH no VPS) |
| Repositório | GitHub (`happydo-guard`) |
| CI/CD Server | GitHub Actions → deploy VPS |
| **CI/CD Android** | **GitHub Actions → build APK (JDK 17 + Android SDK)** |
| Banco | PostgreSQL + pgvector no VPS |
| Monitoramento | Healthcheck custom |

### Workflow do Guard Cam

```
Claude Code → escreve Kotlin → push guard-cam/*
  → GitHub Actions:
    ├── JDK 17 + Android SDK + Gradle cache
    ├── ./gradlew assembleRelease
    ├── Assina APK
    └── Upload artifact / GitHub Release
  → Distribuir: ADB rede | HTTP download | pendrive
```

---

## 9. Custos

| | Valor |
|--|-------|
| CAPEX Pi Zeros | ~R$ 3.000 |
| CAPEX webcams USB | ~R$ 2.000-2.600 |
| **CAPEX total** | **~R$ 5.000-5.600** |
| OPEX Fase 2 | ~R$ 55/mês |
| OPEX Rollout | ~R$ 55-100/mês |

---

## 10. Implementação

### Fase 1 — PoC ✅
3 câmeras MIBO RTMP. Nginx-RTMP + dashboard. 72h estável.

### Fase 2 — Produto (5-6 semanas) ⏳

**Bloco A — Infraestrutura (sem 1-2)**
1-4: HTTPS, snapshot/download, limpeza por câmera, seed PDVs

**Bloco B — Motion + Gravação (sem 2-3)**
5-8: Motion detector, FFmpeg por evento, API eventos, sensibilidade

**Bloco C — Face Recognition (sem 3-5)**
9-15: InsightFace, pgvector, indexação, face search, watchlist, visitantes, audit

**Bloco D — Desenvolvimento Guard Cam + Busca Cruzada (sem 4-6)**
16. Scaffold Kotlin + Gradle no repo `guard-cam/`
17. GitHub Actions: workflow build APK (JDK 17 + Android SDK)
18. CameraManager: câmera integrada + USB UVC
19. RtmpPublisher: H.264 hardware + RTMP push
20. StreamService: Foreground Service + auto-start + reconnect
21. Config via QR code / setup
22. API: /guard-cam/config + heartbeat
23. Testar PIPO X9R + Sunmi D2 Mini + Lenovo Tab
24. Distribuição APK (ADB rede + HTTP download)
25. Dashboard: busca cruzada por timestamp (mosaico)
26. API: /pdvs/:id/recordings + /recordings/cross-search

### Fase 3 — Piloto (5 PDVs)
1. Pi Zero para ICs
2. Guard Cam em 5 dispositivos + webcams
3. Alertas offline (webhook)
4. Auth JWT

### Fase 4 — Rollout (~80 câmeras + ~70 Guard Cams)
1. Config ~77 câmeras iM
2. Guard Cam em todos Android
3. Webcams USB onde necessário
4. Pi Zeros para ICs
5. API Key integração
6. Monitoramento

### Fase 5 — IA Avançada
1. YOLO: ações suspeitas, contagem produtos
2. Heatmaps
3. P2P TUTK/Kalay
4. Migrar IC → iM

---

## 11. Estrutura do Repositório

```
happydo-guard/
├── ARCHITECTURE.md
├── docker-compose.yml
├── .github/workflows/
│   ├── deploy.yml                     ← CI/CD SERVIDOR
│   └── android-build.yml             ← CI/CD GUARD CAM APK
├── server/
│   ├── nginx-rtmp/nginx.conf
│   ├── api/src/
│   │   ├── routes/
│   │   │   ├── cameras.js
│   │   │   ├── recordings.js         ← BUSCA CRUZADA
│   │   │   ├── faces.js
│   │   │   ├── guard-cam.js
│   │   │   ├── events.js
│   │   │   └── webhooks.js
│   │   ├── services/
│   │   │   ├── motion-detector.js
│   │   │   ├── face-recognition.js
│   │   │   ├── watchlist.js
│   │   │   ├── recorder.js
│   │   │   └── health.js
│   │   └── db/
├── dashboard/src/pages/
│   ├── Live.jsx
│   ├── Playback.jsx
│   ├── CrossSearch.jsx                ← MOSAICO SINCRONIZADO
│   ├── FaceSearch.jsx
│   ├── Watchlist.jsx
│   ├── Visitors.jsx
│   ├── GuardCams.jsx
│   └── Settings.jsx
├── guard-cam/                         ← APP ANDROID (KOTLIN)
│   ├── README.md
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradle/
│   │   └── libs.versions.toml        ← VERSION CATALOG
│   └── app/
│       ├── build.gradle.kts
│       └── src/main/
│           ├── AndroidManifest.xml
│           └── java/com/happydo/guardcam/
│               ├── GuardCamApp.kt
│               ├── service/
│               │   ├── StreamService.kt
│               │   ├── CameraManager.kt
│               │   └── RtmpPublisher.kt
│               ├── config/
│               │   ├── DeviceConfig.kt
│               │   └── QrCodeScanner.kt
│               └── ui/
│                   ├── SetupActivity.kt
│                   └── StatusOverlay.kt
├── agent/ (Pi Zero)
└── docs/
    ├── guard-cam-setup.md
    └── guard-cam-distribution.md
```

---

## 12. Notas

### Kotlin vs React Native
Kotlin nativo: ~30MB RAM. React Native: ~100MB. Em 2GB RAM a diferença é a viabilidade do projeto.

### Build sem Android Studio
GitHub Actions compila o APK na cloud. Desenvolvedor escreve Kotlin no Claude Code (SSH), push no GitHub, Actions gera APK assinado. Zero dependência local.

### Armazenamento Unificado
MIBO e Guard Cam: mesmo Nginx-RTMP, pipeline, FFmpeg, pgvector, endpoints. Distinção apenas lógica no banco.

### Busca Cruzada + Face Search
Face search retorna timestamps → cada resultado tem link de busca cruzada → Dashboard monta mosaico automaticamente.
