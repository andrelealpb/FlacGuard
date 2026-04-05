-- PR 1: Tracking-based visitor counting infrastructure
-- Adds person_tracks table and track_id column to face_embeddings.
-- The PR 2 will update motion-detector and counting logic to use these.
-- This migration is backwards-compatible: existing data keeps working.

CREATE TABLE IF NOT EXISTS person_tracks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  -- Internal tracker ID from ByteTrack (not globally unique, scoped per camera session)
  tracker_id INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  -- Best face embedding from the track (highest quality_score frame)
  best_embedding vector(512),
  best_face_image VARCHAR(1000),
  best_face_image_s3_key VARCHAR(1000),
  best_quality_score REAL,
  -- How many frames contributed faces to this track
  face_count INTEGER NOT NULL DEFAULT 0,
  -- Optional link to a known person profile (set via Persons feature)
  person_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_tracks_camera_id ON person_tracks(camera_id);
CREATE INDEX IF NOT EXISTS idx_person_tracks_tenant_started ON person_tracks(tenant_id, started_at);
CREATE INDEX IF NOT EXISTS idx_person_tracks_ended_at ON person_tracks(ended_at);
CREATE INDEX IF NOT EXISTS idx_person_tracks_person_id ON person_tracks(person_id) WHERE person_id IS NOT NULL;

-- HNSW index for cross-camera dedup clustering on best_embedding
CREATE INDEX IF NOT EXISTS idx_person_tracks_best_embedding
  ON person_tracks USING hnsw (best_embedding vector_cosine_ops)
  WHERE best_embedding IS NOT NULL;

-- Add track_id to face_embeddings so every detection can be linked to its track
ALTER TABLE face_embeddings ADD COLUMN IF NOT EXISTS track_id UUID;
CREATE INDEX IF NOT EXISTS idx_face_embeddings_track_id
  ON face_embeddings(track_id) WHERE track_id IS NOT NULL;
