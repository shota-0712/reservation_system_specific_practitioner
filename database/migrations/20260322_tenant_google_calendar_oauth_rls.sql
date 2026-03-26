-- ============================================================
-- Google Calendar OAuth RLS hardening
-- Purpose: enforce tenant isolation on tenant_google_calendar_oauth
-- Created: 2026-03-22
-- ============================================================

BEGIN;

ALTER TABLE tenant_google_calendar_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_google_calendar_oauth FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tenant_google_calendar_oauth'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON tenant_google_calendar_oauth FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

COMMIT;
