-- Denormalize oldest_recording_at on cameras so /cameras/disk-usage
-- doesn't have to scan the recordings table on every request.
-- See issue andrelealpb/FlacGuard#98.

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS oldest_recording_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cameras_oldest_recording_at
  ON cameras(oldest_recording_at);

-- Trigger: keep oldest_recording_at in sync with recordings.
--
-- INSERT: if the new row is older than the current oldest (or the column
--         is NULL), update it. Cheap: single indexed UPDATE.
-- DELETE: only recompute if the deleted row WAS the current oldest for
--         that camera. If the deleted started_at doesn't match, we're
--         done in one indexed EXISTS check. Retention-driven bulk DELETEs
--         always hit this path, but the recompute only fires when the
--         min actually changes (usually once per day, not per row).
CREATE OR REPLACE FUNCTION refresh_cam_oldest_recording()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE cameras
       SET oldest_recording_at = NEW.started_at
     WHERE id = NEW.camera_id
       AND (oldest_recording_at IS NULL OR NEW.started_at < oldest_recording_at);
  ELSIF (TG_OP = 'DELETE') THEN
    IF EXISTS (
      SELECT 1 FROM cameras
       WHERE id = OLD.camera_id
         AND oldest_recording_at = OLD.started_at
    ) THEN
      UPDATE cameras c
         SET oldest_recording_at = (
           SELECT MIN(started_at) FROM recordings r WHERE r.camera_id = c.id
         )
       WHERE c.id = OLD.camera_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recordings_refresh_cam_oldest ON recordings;
CREATE TRIGGER trg_recordings_refresh_cam_oldest
AFTER INSERT OR DELETE ON recordings
FOR EACH ROW EXECUTE FUNCTION refresh_cam_oldest_recording();

-- One-time backfill for existing cameras
UPDATE cameras c
   SET oldest_recording_at = sub.min_started
  FROM (
    SELECT camera_id, MIN(started_at) AS min_started
    FROM recordings
    GROUP BY camera_id
  ) sub
 WHERE c.id = sub.camera_id
   AND (c.oldest_recording_at IS NULL OR c.oldest_recording_at <> sub.min_started);
