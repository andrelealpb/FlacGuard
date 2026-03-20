-- Migration 008: Multi-tenant support
-- Every main table gets a tenant_id column.
-- Existing data is assigned to the default tenant (Happydo).

-- Ensure uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants table (SaaS clients)
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,
  plan        VARCHAR(50)  NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter', 'professional', 'enterprise')),
  max_cameras    INTEGER NOT NULL DEFAULT 10,
  max_storage_gb INTEGER NOT NULL DEFAULT 50,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  settings    JSONB       DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create default tenant (Happydo = tenant zero)
INSERT INTO tenants (name, slug, plan, max_cameras, max_storage_gb)
VALUES ('Happydo Mercadinhos', 'happydo', 'enterprise', 200, 1000)
ON CONFLICT (slug) DO NOTHING;

-- Add tenant_id to all main tables
-- Default to the Happydo tenant for existing data
DO $$
DECLARE
  default_tenant UUID;
BEGIN
  SELECT id INTO default_tenant FROM tenants WHERE slug = 'happydo';

  -- PDVs
  ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE pdvs SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE pdvs ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE pdvs ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_pdvs_tenant ON pdvs(tenant_id);

  -- Cameras
  ALTER TABLE cameras ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE cameras SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE cameras ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE cameras ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_cameras_tenant ON cameras(tenant_id);

  -- Users
  ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE users SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

  -- API Keys
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE api_keys SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE api_keys ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE api_keys ALTER COLUMN tenant_id SET DEFAULT default_tenant;

  -- Webhooks
  ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE webhooks SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE webhooks ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN tenant_id SET DEFAULT default_tenant;

  -- Face watchlist
  ALTER TABLE face_watchlist ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE face_watchlist SET tenant_id = default_tenant WHERE tenant_id IS NULL;
  ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET NOT NULL;
  ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET DEFAULT default_tenant;
  CREATE INDEX IF NOT EXISTS idx_watchlist_tenant ON face_watchlist(tenant_id);
END $$;
