-- CRM-BE-006: tenant_notification_settings
-- テナント単位の通知設定（管理画面 notifications タブ）を永続化する。
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_notification_settings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    email_new_reservation   BOOLEAN NOT NULL DEFAULT TRUE,
    email_cancellation      BOOLEAN NOT NULL DEFAULT TRUE,
    email_daily_report      BOOLEAN NOT NULL DEFAULT TRUE,
    line_reminder           BOOLEAN NOT NULL DEFAULT TRUE,
    line_confirmation       BOOLEAN NOT NULL DEFAULT TRUE,
    line_review             BOOLEAN NOT NULL DEFAULT TRUE,
    push_new_reservation    BOOLEAN NOT NULL DEFAULT TRUE,
    push_cancellation       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by              TEXT
);

ALTER TABLE tenant_notification_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tenant_notification_settings'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON tenant_notification_settings
            USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
    END IF;
END $$;

COMMENT ON TABLE tenant_notification_settings IS 'Per-tenant notification preferences for admin settings UI.';

COMMIT;
