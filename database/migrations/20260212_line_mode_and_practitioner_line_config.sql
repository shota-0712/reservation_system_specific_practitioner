-- ============================================================
-- Schema Migration v2.6 -> v2.7 (LINE mode + store/practitioner LINE config)
-- Focus: 店舗単位/施術者単位LINE運用の切替と設定カラム追加
-- Created: 2026-02-12
-- ============================================================

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS line_mode VARCHAR(20) NOT NULL DEFAULT 'tenant';

DO $$
BEGIN
    ALTER TABLE tenants
        DROP CONSTRAINT IF EXISTS tenants_line_mode_check;
    ALTER TABLE tenants
        ADD CONSTRAINT tenants_line_mode_check
        CHECK (line_mode IN ('tenant', 'store', 'practitioner'));
END $$;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_liff_id VARCHAR(80);

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_id VARCHAR(80);

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_access_token_encrypted TEXT;

ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS line_channel_secret_encrypted TEXT;

ALTER TABLE practitioners
    ADD COLUMN IF NOT EXISTS line_liff_id VARCHAR(80);

ALTER TABLE practitioners
    ADD COLUMN IF NOT EXISTS line_channel_id VARCHAR(80);

ALTER TABLE practitioners
    ADD COLUMN IF NOT EXISTS line_channel_access_token_encrypted TEXT;

ALTER TABLE practitioners
    ADD COLUMN IF NOT EXISTS line_channel_secret_encrypted TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_line_mode
    ON tenants (line_mode);

CREATE INDEX IF NOT EXISTS idx_practitioners_line_liff_id
    ON practitioners (tenant_id, line_liff_id)
    WHERE line_liff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stores_line_liff_id
    ON stores (tenant_id, line_liff_id)
    WHERE line_liff_id IS NOT NULL;

COMMIT;
