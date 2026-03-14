-- Migration: Add recording settings to cameras

-- Recording mode: continuous (always recording) or motion (only when motion detected)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS recording_mode VARCHAR(20) NOT NULL DEFAULT 'continuous'
  CHECK (recording_mode IN ('continuous', 'motion'));

-- Retention days: how long to keep recordings (default 21, max 60)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 21
  CHECK (retention_days >= 1 AND retention_days <= 60);

-- Motion sensitivity: threshold for motion detection (1-100, lower = more sensitive)
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS motion_sensitivity INTEGER NOT NULL DEFAULT 5
  CHECK (motion_sensitivity >= 1 AND motion_sensitivity <= 100);

-- Add thumbnail_path to recordings for motion events
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(1000);

-- Add recording_type to distinguish continuous vs motion recordings
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS recording_type VARCHAR(20) NOT NULL DEFAULT 'continuous'
  CHECK (recording_type IN ('continuous', 'motion'));
