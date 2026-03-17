-- ============================================================
-- v3 Hard Cleanup Migration
-- Purpose: Remove legacy columns from existing (upgraded) databases
--          so they match the fresh v3 schema.
-- Apply to: Existing databases that went through the migration
--           path (001_initial_schema.sql + migrations up to 20260311).
-- DO NOT apply to: Fresh databases bootstrapped with the new
--                  database/schema/001_initial_schema.sql.
--
-- Idempotent: Yes – all operations use IF EXISTS / conditional guards.
-- Created: 2026-03-09
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60min';

-- ============================================================
-- PRECHECK: Ensure assignment tables have data before dropping
-- legacy array columns. If the assignment tables are empty but
-- the legacy columns are not, something went wrong in a prior
-- migration. We fail fast rather than silently lose data.
-- ============================================================
DO $$
DECLARE
    legacy_practitioner_store_count BIGINT;
    assignment_practitioner_store_count BIGINT;
    legacy_admin_store_count BIGINT;
    assignment_admin_store_count BIGINT;
BEGIN
    -- Check practitioner store_ids vs assignment table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'practitioners' AND column_name = 'store_ids'
    ) THEN
        SELECT COUNT(*) INTO legacy_practitioner_store_count
        FROM practitioners
        WHERE array_length(store_ids, 1) > 0;

        SELECT COUNT(*) INTO assignment_practitioner_store_count
        FROM practitioner_store_assignments;

        IF legacy_practitioner_store_count > 0 AND assignment_practitioner_store_count = 0 THEN
            RAISE EXCEPTION
                'PRECHECK FAILED: practitioners.store_ids has % rows with data '
                'but practitioner_store_assignments is empty. '
                'Run the 20260306 migration first to backfill assignment tables.',
                legacy_practitioner_store_count
            USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Check admins store_ids vs assignment table
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'admins' AND column_name = 'store_ids'
    ) THEN
        SELECT COUNT(*) INTO legacy_admin_store_count
        FROM admins
        WHERE array_length(store_ids, 1) > 0;

        SELECT COUNT(*) INTO assignment_admin_store_count
        FROM admin_store_assignments;

        IF legacy_admin_store_count > 0 AND assignment_admin_store_count = 0 THEN
            RAISE EXCEPTION
                'PRECHECK FAILED: admins.store_ids has % rows with data '
                'but admin_store_assignments is empty. '
                'Run the 20260306 migration first to backfill assignment tables.',
                legacy_admin_store_count
            USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RAISE NOTICE 'PRECHECK PASSED: Assignment tables are populated or legacy columns are already absent.';
END $$;

-- ============================================================
-- 1. Drop sync trigger and function (legacy compatibility layer)
-- ============================================================
DROP TRIGGER IF EXISTS sync_reservation_time_fields_trigger ON reservations;
DROP FUNCTION IF EXISTS sync_reservation_time_fields() CASCADE;

-- ============================================================
-- 2. Drop legacy reservation time indexes (date-based)
-- ============================================================
DROP INDEX IF EXISTS idx_reservations_date;        -- (tenant_id, date)
DROP INDEX IF EXISTS idx_reservations_period;       -- GIST (tenant_id, period)

-- ============================================================
-- 3. Drop old exclusion constraint (period-based) if still present
--    The v3 constraint (reservations_no_overlap_v3) replaces it.
-- ============================================================
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'reservations'::regclass
          AND contype = 'x'
          AND conname <> 'reservations_no_overlap_v3'
    LOOP
        EXECUTE format('ALTER TABLE reservations DROP CONSTRAINT %I', rec.conname);
        RAISE NOTICE 'Dropped old exclusion constraint: %', rec.conname;
    END LOOP;
END $$;

-- ============================================================
-- 4. Drop legacy reservation columns
-- ============================================================
ALTER TABLE reservations DROP COLUMN IF EXISTS period;
ALTER TABLE reservations DROP COLUMN IF EXISTS date;
ALTER TABLE reservations DROP COLUMN IF EXISTS start_time;
ALTER TABLE reservations DROP COLUMN IF EXISTS end_time;

-- ============================================================
-- 5. Drop legacy practitioner array column and index
-- ============================================================
DROP INDEX IF EXISTS idx_menu_options_applicable_menus;  -- GIN on applicable_menu_ids

ALTER TABLE practitioners DROP COLUMN IF EXISTS store_ids;
ALTER TABLE menus DROP COLUMN IF EXISTS practitioner_ids;
ALTER TABLE menu_options DROP COLUMN IF EXISTS applicable_menu_ids;
ALTER TABLE admins DROP COLUMN IF EXISTS store_ids;

-- ============================================================
-- 6. Drop migration_progress / migration_errors tables if present
--    (cleanup of old dual-write infrastructure)
-- ============================================================
DROP TABLE IF EXISTS migration_progress CASCADE;
DROP TABLE IF EXISTS migration_errors CASCADE;

-- ============================================================
-- 7. Verify final state: legacy columns must not exist
-- ============================================================
DO $$
DECLARE
    bad_col TEXT;
BEGIN
    SELECT table_name || '.' || column_name INTO bad_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
          (table_name = 'reservations' AND column_name IN ('period', 'date', 'start_time', 'end_time'))
          OR (table_name = 'practitioners' AND column_name = 'store_ids')
          OR (table_name = 'menus' AND column_name = 'practitioner_ids')
          OR (table_name = 'menu_options' AND column_name = 'applicable_menu_ids')
          OR (table_name = 'admins' AND column_name = 'store_ids')
      )
    LIMIT 1;

    IF bad_col IS NOT NULL THEN
        RAISE EXCEPTION 'POST-CHECK FAILED: Legacy column % still exists after cleanup.', bad_col
            USING ERRCODE = 'P0001';
    END IF;

    RAISE NOTICE 'POST-CHECK PASSED: All legacy columns have been removed.';
END $$;

COMMIT;
