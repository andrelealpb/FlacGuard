-- Persons: named identity profiles built from grouped face embeddings.
-- A person can optionally be linked to a watchlist entry.
-- The key insight: a person is identified by ALL their embeddings (different
-- appearances: clothes, hat, hair, etc.), not just one photo.

CREATE TABLE IF NOT EXISTS persons (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  photo_path  VARCHAR(1000),       -- representative face crop
  created_by  UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Link face_watchlist to a person (optional — watchlist entry can use person's embeddings)
ALTER TABLE face_watchlist
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_face_watchlist_person_id
  ON face_watchlist(person_id) WHERE person_id IS NOT NULL;

-- Link face_embeddings.person_id now references persons table.
-- NOTE: existing person_id UUIDs are auto-generated (no matching persons row).
-- We do NOT add a FK constraint to avoid breaking existing data.
-- New person_ids created via the persons feature will match a persons row.
