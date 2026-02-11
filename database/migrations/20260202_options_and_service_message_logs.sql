-- ============================================================
-- Schema Migration v2.1 -> v2.2 (Cloud SQL)
-- Focus: menu_options拡張 / service_message_logs 追加
-- Created: 2026-02-02
-- ============================================================

BEGIN;

-- 1) menu_options: 説明と適用メニューを追加
ALTER TABLE menu_options
    ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE menu_options
    ADD COLUMN IF NOT EXISTS applicable_menu_ids UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_menu_options_applicable_menus
    ON menu_options USING GIN (applicable_menu_ids);

-- 2) service_message_logs テーブル追加
CREATE TABLE IF NOT EXISTS service_message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    message_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('success', 'failed')),
    error TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_message_logs_tenant
    ON service_message_logs (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_message_logs_reservation
    ON service_message_logs (reservation_id);

-- RLS
ALTER TABLE service_message_logs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'service_message_logs'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON service_message_logs FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

-- 3) reservations: reminder_sent_at 追加
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMIT;
