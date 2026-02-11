-- ============================================================
-- Schema Migration v2.5 -> v2.6 (Public Tenant Onboarding)
-- Focus: 公開セルフ登録の進捗管理カラム
-- Created: 2026-02-11
-- ============================================================

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(20) NOT NULL DEFAULT 'pending';

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS onboarding_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tenants_onboarding_status_check'
    ) THEN
        ALTER TABLE tenants
            ADD CONSTRAINT tenants_onboarding_status_check
            CHECK (onboarding_status IN ('pending', 'in_progress', 'completed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenants_onboarding_status
    ON tenants (onboarding_status, updated_at DESC);

UPDATE tenants
SET onboarding_status = CASE
        WHEN status IN ('active', 'trial') THEN 'in_progress'
        ELSE 'pending'
    END,
    onboarding_completed_at = CASE
        WHEN status = 'active' THEN COALESCE(onboarding_completed_at, NOW())
        ELSE onboarding_completed_at
    END
WHERE onboarding_status = 'pending';

COMMIT;
