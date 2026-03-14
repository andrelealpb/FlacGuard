-- Migration: Add Pulse sync fields to pdvs table and constrain camera models

-- PDVs: add Pulse-specific columns
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS pulse_id UUID UNIQUE;
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS code VARCHAR(20);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS bairro VARCHAR(100);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS cep VARCHAR(10);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS bandeira VARCHAR(255);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS pulse_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pdvs_pulse_id ON pdvs(pulse_id);

-- Cameras: constrain model to known Intelbras models
-- First update any existing data to match the new constraint
UPDATE cameras SET model = 'iM5 SC' WHERE model NOT IN ('iM3 C', 'iM5 SC', 'iMX', 'IC3', 'IC5');

-- Drop old generic constraint and add new one
ALTER TABLE cameras DROP CONSTRAINT IF EXISTS cameras_model_check;
ALTER TABLE cameras ADD CONSTRAINT cameras_model_check
  CHECK (model IN ('iM3 C', 'iM5 SC', 'iMX', 'IC3', 'IC5'));

-- Update default
ALTER TABLE cameras ALTER COLUMN model SET DEFAULT 'iM5 SC';
