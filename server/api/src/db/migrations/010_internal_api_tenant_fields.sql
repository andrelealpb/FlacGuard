-- Migration 010: Add tenant fields for flac-guard-control integration
-- These fields are managed by the control VPS when provisioning/updating tenants.

-- Add plan-related limits to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_pdvs INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_cameras_per_pdv INTEGER NOT NULL DEFAULT 3;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_facial_per_pdv INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 21;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{"video_search": false, "visitors": false, "erp_integration": false}';

-- Update existing 'happydo' tenant with enterprise-level defaults
UPDATE tenants SET
  max_pdvs = 100,
  max_cameras_per_pdv = 3,
  free_facial_per_pdv = 3,
  retention_days = 21,
  features = '{"video_search": true, "visitors": true, "erp_integration": true}'
WHERE slug = 'happydo';
