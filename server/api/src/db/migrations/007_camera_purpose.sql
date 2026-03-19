-- Migration 007: Camera purpose (environment vs face) and face capture toggle
--
-- camera_purpose: 'environment' (default) or 'face' — defines camera type
-- capture_face: whether this camera should run face detection (default true)
--
-- Face cameras are prioritized for visitor counting.
-- Environment cameras with capture_face=true serve as fallback.

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS camera_purpose VARCHAR(20) NOT NULL DEFAULT 'environment'
    CHECK (camera_purpose IN ('environment', 'face')),
  ADD COLUMN IF NOT EXISTS capture_face BOOLEAN NOT NULL DEFAULT true;
