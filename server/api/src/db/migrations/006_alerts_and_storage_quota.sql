-- Migration 006: System alerts table + storage quota per camera

-- System alerts (disk usage warnings, quota exceeded, etc.)
CREATE TABLE IF NOT EXISTS system_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(50) NOT NULL,       -- 'disk_warning', 'disk_critical', 'quota_exceeded'
  severity    VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
  title       VARCHAR(255) NOT NULL,
  message     TEXT NOT NULL,
  camera_id   UUID REFERENCES cameras(id) ON DELETE CASCADE,
  metadata    JSONB DEFAULT '{}',          -- extra data (disk_percent, quota_gb, etc.)
  resolved    BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON system_alerts(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON system_alerts(type, resolved);

-- Storage quota per camera (NULL = unlimited)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS storage_quota_gb NUMERIC(6,2) DEFAULT NULL;
