-- Camera availability log for SaaS uptime tracking.
-- Records online/offline intervals per camera, queryable by Control.

CREATE TABLE IF NOT EXISTS camera_availability_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  status VARCHAR(10) NOT NULL CHECK (status IN ('online', 'offline')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cam_avail_camera_id ON camera_availability_log(camera_id);
CREATE INDEX idx_cam_avail_tenant_started ON camera_availability_log(tenant_id, started_at);

-- Seed initial records for existing cameras so the log starts from now
INSERT INTO camera_availability_log (camera_id, tenant_id, status, started_at)
SELECT id, tenant_id, status, COALESCE(last_seen_at, created_at)
FROM cameras
WHERE id NOT IN (SELECT DISTINCT camera_id FROM camera_availability_log);
