-- HappyDo Guard — Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PDVs (Pontos de Venda / mercadinhos autônomos)
-- Synced from HappyDoPulse API
CREATE TABLE pdvs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pulse_id        UUID         UNIQUE,
  code            VARCHAR(20),
  name            VARCHAR(255) NOT NULL,
  address         VARCHAR(500) NOT NULL,
  bairro          VARCHAR(100),
  city            VARCHAR(100) NOT NULL DEFAULT 'João Pessoa',
  state           VARCHAR(2)   NOT NULL DEFAULT 'PB',
  cep             VARCHAR(10),
  bandeira        VARCHAR(255),
  latitude        DECIMAL(10,8),
  longitude       DECIMAL(11,8),
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  pulse_synced_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdvs_pulse_id ON pdvs(pulse_id);

-- Câmeras
CREATE TABLE cameras (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 VARCHAR(255) NOT NULL,
  stream_key           VARCHAR(64)  NOT NULL UNIQUE,
  model                VARCHAR(100) NOT NULL DEFAULT 'iM5 SC'
    CHECK (model IN ('iM3 C', 'iM5 SC', 'iMX', 'IC3', 'IC5')),
  camera_group         VARCHAR(10)  NOT NULL DEFAULT 'im'
    CHECK (camera_group IN ('im', 'ic')),
  location_description VARCHAR(500),
  status               VARCHAR(20)  NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'error')),
  pdv_id               UUID         NOT NULL REFERENCES pdvs(id),
  last_seen_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_cameras_pdv_id ON cameras(pdv_id);
CREATE INDEX idx_cameras_stream_key ON cameras(stream_key);
CREATE INDEX idx_cameras_status ON cameras(status);

-- Gravações
CREATE TABLE recordings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id  UUID         NOT NULL REFERENCES cameras(id),
  file_path  VARCHAR(1000) NOT NULL,
  file_size  BIGINT,
  duration   INTEGER,
  started_at TIMESTAMPTZ  NOT NULL,
  ended_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_recordings_camera_id ON recordings(camera_id);
CREATE INDEX idx_recordings_started_at ON recordings(started_at);

-- Eventos (movimento, offline, IA, etc.)
CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id  UUID         NOT NULL REFERENCES cameras(id),
  type       VARCHAR(50)  NOT NULL CHECK (type IN ('motion', 'offline', 'online', 'error', 'ai_alert')),
  payload    JSONB        DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_camera_id ON events(camera_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_created_at ON events(created_at);

-- Usuários
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  hashed_password VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- API Keys (server-to-server)
CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        VARCHAR(64)  NOT NULL UNIQUE,
  name       VARCHAR(255) NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Settings (key-value config, e.g. Pulse credentials)
CREATE TABLE settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Webhooks
CREATE TABLE webhooks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url        VARCHAR(1000) NOT NULL,
  events     TEXT[]        NOT NULL DEFAULT '{}',
  secret     VARCHAR(64),
  is_active  BOOLEAN       NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);
