-- Migration 009: S3 object storage support
-- Adds s3_key columns to recordings and face_embeddings.
-- When s3_key IS NOT NULL, the file lives in S3; otherwise on local disk.

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS s3_key VARCHAR(1000);
ALTER TABLE face_embeddings ADD COLUMN IF NOT EXISTS face_image_s3_key VARCHAR(1000);
ALTER TABLE face_watchlist ADD COLUMN IF NOT EXISTS photo_s3_key VARCHAR(1000);

CREATE INDEX IF NOT EXISTS idx_recordings_s3_key ON recordings(s3_key) WHERE s3_key IS NOT NULL;
