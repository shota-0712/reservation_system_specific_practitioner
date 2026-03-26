-- ============================================================
-- Salonboard hardening migration
-- Purpose:
--   - enforce tenant isolation on tenant_salonboard_config
--   - add nullable unique partial index for reservations.salonboard_reservation_id
-- Notes:
--   - idempotent
--   - safe for existing databases
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE tenant_salonboard_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_salonboard_config FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tenant_salonboard_config'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON tenant_salonboard_config FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

DROP INDEX IF EXISTS idx_reservations_salonboard;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_salonboard
    ON reservations (tenant_id, salonboard_reservation_id)
    WHERE salonboard_reservation_id IS NOT NULL;

COMMIT;
