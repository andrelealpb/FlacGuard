-- Tracks every recording that was discarded by the recorder due to corruption
-- (invalid MP4, too small, missing file) or S3 upload failure.
-- Used to identify cameras with connectivity issues and surface health status.

CREATE TABLE IF NOT EXISTS recording_failures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  reason VARCHAR(50) NOT NULL CHECK (reason IN (
    'invalid_mp4',        -- ffprobe rejected: no moov atom or no video stream
    'too_small',          -- file <= 10KB, likely aborted before any keyframe
    'missing_file',       -- ffmpeg reported success but file not found on disk
    's3_upload_failed'    -- file was valid but uploadRecording returned null
  )),
  file_size BIGINT,
  duration_seconds INT,
  started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recording_failures_camera
  ON recording_failures(camera_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recording_failures_tenant_created
  ON recording_failures(tenant_id, created_at DESC);
