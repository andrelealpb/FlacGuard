-- Face Recognition tables (pgvector + face embeddings + watchlist + visitors)

CREATE EXTENSION IF NOT EXISTS vector;

-- Face embeddings: detected faces from camera frames
CREATE TABLE face_embeddings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id   UUID         NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  embedding   vector(512)  NOT NULL,
  face_image  VARCHAR(1000),          -- path to cropped face JPEG
  confidence  REAL         NOT NULL DEFAULT 0,
  detected_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_face_embeddings_camera_id ON face_embeddings(camera_id);
CREATE INDEX idx_face_embeddings_detected_at ON face_embeddings(detected_at);

-- HNSW index for fast vector similarity search
CREATE INDEX idx_face_embeddings_vector ON face_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Face watchlist: persons of interest (permanent, not subject to retention)
CREATE TABLE face_watchlist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  photo_path  VARCHAR(1000),
  embedding   vector(512)  NOT NULL,
  alert_type  VARCHAR(50)  NOT NULL DEFAULT 'suspect'
    CHECK (alert_type IN ('suspect', 'employee', 'vip', 'banned')),
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_by  UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_face_watchlist_active ON face_watchlist(is_active) WHERE is_active = true;

-- Face alerts: watchlist matches found in camera feeds
CREATE TABLE face_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id    UUID         NOT NULL REFERENCES face_watchlist(id) ON DELETE CASCADE,
  face_embedding_id UUID      NOT NULL REFERENCES face_embeddings(id) ON DELETE CASCADE,
  camera_id       UUID         NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  similarity      REAL         NOT NULL,
  snapshot_path   VARCHAR(1000),
  acknowledged    BOOLEAN      NOT NULL DEFAULT false,
  acknowledged_by UUID         REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_face_alerts_watchlist_id ON face_alerts(watchlist_id);
CREATE INDEX idx_face_alerts_camera_id ON face_alerts(camera_id);
CREATE INDEX idx_face_alerts_created_at ON face_alerts(created_at);
CREATE INDEX idx_face_alerts_unack ON face_alerts(acknowledged) WHERE acknowledged = false;

-- Daily visitors: distinct face count per camera per day (materialized by cron/job)
CREATE TABLE daily_visitors (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id  UUID    NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  visit_date DATE    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(camera_id, visit_date)
);

CREATE INDEX idx_daily_visitors_date ON daily_visitors(visit_date);

-- Face search audit log (LGPD compliance)
CREATE TABLE face_search_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID         NOT NULL REFERENCES users(id),
  reason     TEXT,
  results    INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
