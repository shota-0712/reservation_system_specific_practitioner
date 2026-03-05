-- Fix claims/sync lookup under RLS:
-- 1) Avoid UUID cast errors when app.current_tenant is empty string.
-- 2) Allow SELECT on admins by firebase_uid only when app.current_firebase_uid matches.
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.admins') IS NULL THEN
        RAISE NOTICE 'Skip admins RLS patch: admins table not found';
    ELSE
        IF EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'admins'
              AND policyname = 'tenant_isolation'
        ) THEN
            ALTER POLICY tenant_isolation ON admins
                USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
                WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'admins'
              AND policyname = 'firebase_uid_lookup'
        ) THEN
            DROP POLICY firebase_uid_lookup ON admins;
        END IF;

        CREATE POLICY firebase_uid_lookup ON admins
            FOR SELECT
            USING (
                firebase_uid = NULLIF(current_setting('app.current_firebase_uid', true), '')
            );
    END IF;
END $$;

COMMIT;
