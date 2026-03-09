-- Resolve booking-link token without tenant context (token-only public flow).
-- SECURITY DEFINER is used so this lookup can work under strict tenant RLS.
BEGIN;

CREATE OR REPLACE FUNCTION resolve_booking_link_token(p_token TEXT)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    store_id UUID,
    practitioner_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        blt.id,
        blt.tenant_id,
        blt.store_id,
        blt.practitioner_id
    FROM booking_link_tokens blt
    WHERE blt.token = p_token
      AND blt.status = 'active'
      AND (blt.expires_at IS NULL OR blt.expires_at > NOW())
    ORDER BY blt.created_at DESC
    LIMIT 1
$$;

REVOKE ALL ON FUNCTION resolve_booking_link_token(TEXT) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT EXECUTE ON FUNCTION resolve_booking_link_token(TEXT) TO app_user;
    END IF;
END $$;

COMMIT;
