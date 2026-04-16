-- Follow-up to migration 015: denormalize recording/face counters on cameras.
-- Goal is to drop /cameras/disk-usage under 100ms by removing the
-- SUM/COUNT scans over recordings and face_embeddings.
-- See issue andrelealpb/FlacGuard#100.

-- 1. Columns on cameras (BIGINT for bytes to avoid INT overflow)
ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS recording_count INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recording_bytes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS face_count      INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS face_bytes      BIGINT NOT NULL DEFAULT 0;

-- 2. face_embeddings.file_size — was being computed via statSync on every
-- request. Denormalize it so the counters above can be maintained cheaply.
ALTER TABLE face_embeddings
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- 3. Trigger function for recordings
-- Uses file_size (existing column, not size_bytes). COALESCE handles the
-- brief window after INSERT where size may be written in a second step.
CREATE OR REPLACE FUNCTION refresh_cam_recording_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE cameras
       SET recording_count = recording_count + 1,
           recording_bytes = recording_bytes + COALESCE(NEW.file_size, 0)
     WHERE id = NEW.camera_id;

  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE cameras
       SET recording_count = GREATEST(0, recording_count - 1),
           recording_bytes = GREATEST(0, recording_bytes - COALESCE(OLD.file_size, 0))
     WHERE id = OLD.camera_id;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN
      UPDATE cameras
         SET recording_bytes = GREATEST(0, recording_bytes
                                           - COALESCE(OLD.file_size, 0)
                                           + COALESCE(NEW.file_size, 0))
       WHERE id = NEW.camera_id;
    END IF;
    -- If camera_id changed (shouldn't happen in practice) we'd need to
    -- rebalance between two cameras — ignore for now since it's not a
    -- code path anyone exercises.
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recordings_refresh_cam_counters ON recordings;
CREATE TRIGGER trg_recordings_refresh_cam_counters
AFTER INSERT OR UPDATE OR DELETE ON recordings
FOR EACH ROW EXECUTE FUNCTION refresh_cam_recording_counters();

-- 4. Trigger function for face_embeddings (same pattern)
CREATE OR REPLACE FUNCTION refresh_cam_face_counters()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE cameras
       SET face_count = face_count + 1,
           face_bytes = face_bytes + COALESCE(NEW.file_size, 0)
     WHERE id = NEW.camera_id;

  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE cameras
       SET face_count = GREATEST(0, face_count - 1),
           face_bytes = GREATEST(0, face_bytes - COALESCE(OLD.file_size, 0))
     WHERE id = OLD.camera_id;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN
      UPDATE cameras
         SET face_bytes = GREATEST(0, face_bytes
                                      - COALESCE(OLD.file_size, 0)
                                      + COALESCE(NEW.file_size, 0))
       WHERE id = NEW.camera_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_face_embeddings_refresh_cam_counters ON face_embeddings;
CREATE TRIGGER trg_face_embeddings_refresh_cam_counters
AFTER INSERT OR UPDATE OR DELETE ON face_embeddings
FOR EACH ROW EXECUTE FUNCTION refresh_cam_face_counters();

-- 5. Backfill recording counters from the current state of recordings.
-- This is the authoritative snapshot — anything the triggers might have
-- missed is corrected here.
UPDATE cameras c SET
  recording_count = COALESCE(r.cnt, 0),
  recording_bytes = COALESCE(r.bytes, 0)
FROM (
  SELECT camera_id,
         COUNT(*)::int AS cnt,
         COALESCE(SUM(file_size), 0)::bigint AS bytes
  FROM recordings
  GROUP BY camera_id
) r
WHERE c.id = r.camera_id;

-- 6. Backfill face counters. file_size is NULL for legacy rows until the
-- runtime path starts filling it — the COUNT is accurate either way,
-- and bytes will self-correct as old rows age out of retention.
UPDATE cameras c SET
  face_count = COALESCE(f.cnt, 0),
  face_bytes = COALESCE(f.bytes, 0)
FROM (
  SELECT camera_id,
         COUNT(*)::int AS cnt,
         COALESCE(SUM(file_size), 0)::bigint AS bytes
  FROM face_embeddings
  GROUP BY camera_id
) f
WHERE c.id = f.camera_id;
