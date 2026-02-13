-- ============================================================
-- Schema Migration v2.7 -> v2.8 (Booking Link Tokens)
-- Focus: 施術者別予約URLのトークン発行
-- Created: 2026-02-13
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS booking_link_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
    token VARCHAR(128) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_link_tokens_token
    ON booking_link_tokens (token);

CREATE INDEX IF NOT EXISTS idx_booking_link_tokens_tenant_status
    ON booking_link_tokens (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_link_tokens_practitioner
    ON booking_link_tokens (tenant_id, practitioner_id, created_at DESC);

ALTER TABLE booking_link_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'booking_link_tokens'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON booking_link_tokens FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

COMMIT;
