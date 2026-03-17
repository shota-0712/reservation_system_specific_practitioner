-- MT-A1: DB strict multi-tenant hardening (Wave-1)
-- 1. FORCE ROW LEVEL SECURITY on CRM extension tables
-- 2. Add resolve_active_store_context() for strict-RLS-safe store_code resolution
-- Idempotent: safe to re-run.

BEGIN;

-- ============================================================
-- 1. FORCE RLS on CRM tables
--    (ENABLE was already applied; FORCE closes the DB-owner bypass)
-- ============================================================

ALTER TABLE tenant_rfm_settings          FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_notification_settings FORCE ROW LEVEL SECURITY;

-- ============================================================
-- 2. resolve_active_store_context(p_store_code text)
--    Returns (tenant_id, store_id) for an active store.
--    SECURITY DEFINER: runs as the function owner (migration_user /
--    superuser) so it can read stores without caller having a
--    tenant context set — which is exactly the bootstrap situation
--    during tenant resolution in the middleware.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_active_store_context(p_store_code text)
RETURNS TABLE (
    tenant_id UUID,
    store_id  UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.tenant_id,
        s.id AS store_id
    FROM stores s
    WHERE s.store_code = p_store_code
      AND s.status     = 'active'
    LIMIT 1;
$$;

-- Restrict direct EXECUTE from PUBLIC; grant only to app_user.
REVOKE ALL ON FUNCTION resolve_active_store_context(text) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT EXECUTE ON FUNCTION resolve_active_store_context(text) TO app_user;
    END IF;
END $$;

COMMIT;
