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
-- Use DO block with EXECUTE to set default from the resolved UUID
DO $$
DECLARE
  tid UUID;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'happydo';

  -- PDVs
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pdvs' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE pdvs ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE pdvs SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE pdvs ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE pdvs ALTER COLUMN tenant_id SET DEFAULT %L', tid);

  -- Cameras
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cameras' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE cameras ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE cameras SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE cameras ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE cameras ALTER COLUMN tenant_id SET DEFAULT %L', tid);

  -- Users
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE users SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT %L', tid);

  -- API Keys
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_keys' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE api_keys ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE api_keys SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE api_keys ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE api_keys ALTER COLUMN tenant_id SET DEFAULT %L', tid);

  -- Webhooks
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='webhooks' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE webhooks ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE webhooks SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE webhooks ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE webhooks ALTER COLUMN tenant_id SET DEFAULT %L', tid);

  -- Face watchlist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='face_watchlist' AND column_name='tenant_id') THEN
    EXECUTE format('ALTER TABLE face_watchlist ADD COLUMN tenant_id UUID REFERENCES tenants(id) DEFAULT %L', tid);
  END IF;
  UPDATE face_watchlist SET tenant_id = tid WHERE tenant_id IS NULL;
  ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET NOT NULL;
  EXECUTE format('ALTER TABLE face_watchlist ALTER COLUMN tenant_id SET DEFAULT %L', tid);
END $$;

-- Create indexes outside DO block
CREATE INDEX IF NOT EXISTS idx_pdvs_tenant ON pdvs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cameras_tenant ON cameras(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_tenant ON face_watchlist(tenant_id);
