-- ============================================================
-- Patch Migration (store line mode support)
-- Reason:
--   - Ensure tenants_line_mode_check includes 'store'
--   - Ensure stores table has LINE config columns used by backend-v2
-- Created: 2026-02-13
-- ============================================================

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS line_mode VARCHAR(20);

UPDATE tenants
SET line_mode = 'tenant'
WHERE line_mode IS NULL;

ALTER TABLE tenants
    ALTER COLUMN line_mode SET DEFAULT 'tenant';

ALTER TABLE tenants
    ALTER COLUMN line_mode SET NOT NULL;

ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_line_mode_check;

ALTER TABLE tenants
    ADD CONSTRAINT tenants_line_mode_check
    CHECK (line_mode IN ('tenant', 'store', 'practitioner'));

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_liff_id VARCHAR(80);

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_id VARCHAR(80);

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_access_token_encrypted TEXT;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_secret_encrypted TEXT;

CREATE INDEX IF NOT EXISTS idx_stores_line_liff_id
    ON stores (tenant_id, line_liff_id)
    WHERE line_liff_id IS NOT NULL;

COMMIT;
