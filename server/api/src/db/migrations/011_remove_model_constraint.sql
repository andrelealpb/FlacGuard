-- Migration 011: Remove model CHECK constraint from cameras
-- Models are now managed by flac-guard-control (dynamic catalog).
-- The node accepts any model string.

ALTER TABLE cameras DROP CONSTRAINT IF EXISTS cameras_model_check;
