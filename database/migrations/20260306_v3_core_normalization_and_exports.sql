-- ============================================================
-- Schema Migration v2.8 -> v3.0 (Core Normalization + Export Jobs)
-- Focus:
--   - Canonical reservation time model (starts_at / ends_at)
--   - Assignment tables for many-to-many relations
--   - Tenant-safe composite foreign keys
--   - Export job infrastructure (CSV)
-- Created: 2026-03-06
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- schema_migrations metadata hardening (version + checksum managed).
ALTER TABLE schema_migrations
    ADD COLUMN IF NOT EXISTS version VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
    ON schema_migrations (version);

-- ============================================================
-- 1) Canonical reservation time fields
-- ============================================================
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Tokyo';

ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

-- Backfill starts_at / ends_at from period first, then from date/time.
UPDATE reservations
SET starts_at = COALESCE(
        starts_at,
        lower(period),
        ((date::text || ' ' || start_time::text)::timestamp AT TIME ZONE COALESCE(timezone, 'Asia/Tokyo'))
    ),
    ends_at = COALESCE(
        ends_at,
        upper(period),
        ((date::text || ' ' || end_time::text)::timestamp AT TIME ZONE COALESCE(timezone, 'Asia/Tokyo'))
    )
WHERE starts_at IS NULL
   OR ends_at IS NULL;

-- Final guard rails for historic malformed rows.
UPDATE reservations
SET starts_at = COALESCE(starts_at, NOW()),
    ends_at = COALESCE(ends_at, COALESCE(starts_at, NOW()) + INTERVAL '30 minutes')
WHERE starts_at IS NULL
   OR ends_at IS NULL;

ALTER TABLE reservations
    ALTER COLUMN starts_at SET NOT NULL;

ALTER TABLE reservations
    ALTER COLUMN ends_at SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reservations_starts_before_ends'
    ) THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_starts_before_ends
            CHECK (starts_at < ends_at);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION sync_reservation_time_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' THEN
        NEW.timezone := 'Asia/Tokyo';
    END IF;

    IF NEW.starts_at IS NULL AND NEW.date IS NOT NULL AND NEW.start_time IS NOT NULL THEN
        NEW.starts_at := ((NEW.date::text || ' ' || NEW.start_time::text)::timestamp AT TIME ZONE NEW.timezone);
    END IF;

    IF NEW.ends_at IS NULL AND NEW.date IS NOT NULL AND NEW.end_time IS NOT NULL THEN
        NEW.ends_at := ((NEW.date::text || ' ' || NEW.end_time::text)::timestamp AT TIME ZONE NEW.timezone);
    END IF;

    IF NEW.starts_at IS NOT NULL THEN
        NEW.date := (NEW.starts_at AT TIME ZONE NEW.timezone)::date;
        NEW.start_time := (NEW.starts_at AT TIME ZONE NEW.timezone)::time;
    END IF;

    IF NEW.ends_at IS NOT NULL THEN
        NEW.end_time := (NEW.ends_at AT TIME ZONE NEW.timezone)::time;
    END IF;

    IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL THEN
        NEW.period := tstzrange(NEW.starts_at, NEW.ends_at, '[)');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_reservation_time_fields_trigger ON reservations;
CREATE TRIGGER sync_reservation_time_fields_trigger
BEFORE INSERT OR UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION sync_reservation_time_fields();

-- Normalize existing rows via trigger execution.
UPDATE reservations
SET updated_at = updated_at;

-- Replace exclusion constraint with canonical starts_at/ends_at-based version.
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
    END LOOP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reservations_no_overlap_v3'
    ) THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_no_overlap_v3
            EXCLUDE USING GIST (
                tenant_id WITH =,
                practitioner_id WITH =,
                tstzrange(starts_at, ends_at, '[)') WITH &&
            ) WHERE (status NOT IN ('canceled', 'no_show'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_tenant_starts_at
    ON reservations (tenant_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_reservations_tenant_store_starts_at
    ON reservations (tenant_id, store_id, starts_at);

-- Reservation status transitions are fixed to preserve conflict semantics:
-- pending -> confirmed/canceled/no_show
-- confirmed -> completed/canceled/no_show
-- completed/canceled/no_show -> immutable
CREATE OR REPLACE FUNCTION enforce_reservation_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'pending'
       AND NEW.status IN ('confirmed', 'canceled', 'no_show') THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'confirmed'
       AND NEW.status IN ('completed', 'canceled', 'no_show') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format('Invalid reservation status transition: %s -> %s', OLD.status, NEW.status);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_reservation_status_transition_trigger ON reservations;
CREATE TRIGGER enforce_reservation_status_transition_trigger
BEFORE UPDATE OF status ON reservations
FOR EACH ROW EXECUTE FUNCTION enforce_reservation_status_transition();

-- ============================================================
-- 2) Composite parent uniqueness for tenant-safe FK references
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_tenant_id_id_unique') THEN
        ALTER TABLE stores
            ADD CONSTRAINT stores_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'practitioners_tenant_id_id_unique') THEN
        ALTER TABLE practitioners
            ADD CONSTRAINT practitioners_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_tenant_id_id_unique') THEN
        ALTER TABLE menus
            ADD CONSTRAINT menus_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_options_tenant_id_id_unique') THEN
        ALTER TABLE menu_options
            ADD CONSTRAINT menu_options_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_tenant_id_id_unique') THEN
        ALTER TABLE admins
            ADD CONSTRAINT admins_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_tenant_id_id_unique') THEN
        ALTER TABLE customers
            ADD CONSTRAINT customers_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tenant_id_id_unique') THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_tenant_id_id_unique UNIQUE (tenant_id, id);
    END IF;
END $$;

-- ============================================================
-- 3) Assignment tables (many-to-many normalization)
-- ============================================================
CREATE TABLE IF NOT EXISTS practitioner_store_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    practitioner_id UUID NOT NULL,
    store_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, practitioner_id, store_id),
    CONSTRAINT practitioner_store_assignments_practitioner_fk
        FOREIGN KEY (tenant_id, practitioner_id)
        REFERENCES practitioners(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT practitioner_store_assignments_store_fk
        FOREIGN KEY (tenant_id, store_id)
        REFERENCES stores(tenant_id, id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS menu_practitioner_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    menu_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, menu_id, practitioner_id),
    CONSTRAINT menu_practitioner_assignments_menu_fk
        FOREIGN KEY (tenant_id, menu_id)
        REFERENCES menus(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT menu_practitioner_assignments_practitioner_fk
        FOREIGN KEY (tenant_id, practitioner_id)
        REFERENCES practitioners(tenant_id, id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS option_menu_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    option_id UUID NOT NULL,
    menu_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, option_id, menu_id),
    CONSTRAINT option_menu_assignments_option_fk
        FOREIGN KEY (tenant_id, option_id)
        REFERENCES menu_options(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT option_menu_assignments_menu_fk
        FOREIGN KEY (tenant_id, menu_id)
        REFERENCES menus(tenant_id, id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_store_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL,
    store_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, admin_id, store_id),
    CONSTRAINT admin_store_assignments_admin_fk
        FOREIGN KEY (tenant_id, admin_id)
        REFERENCES admins(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT admin_store_assignments_store_fk
        FOREIGN KEY (tenant_id, store_id)
        REFERENCES stores(tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_practitioner_store_assignments_store
    ON practitioner_store_assignments (tenant_id, store_id, practitioner_id);

CREATE INDEX IF NOT EXISTS idx_menu_practitioner_assignments_practitioner
    ON menu_practitioner_assignments (tenant_id, practitioner_id, menu_id);

CREATE INDEX IF NOT EXISTS idx_option_menu_assignments_menu
    ON option_menu_assignments (tenant_id, menu_id, option_id);

CREATE INDEX IF NOT EXISTS idx_admin_store_assignments_store
    ON admin_store_assignments (tenant_id, store_id, admin_id);

ALTER TABLE practitioner_store_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_practitioner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE option_menu_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_store_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'practitioner_store_assignments'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON practitioner_store_assignments FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'menu_practitioner_assignments'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON menu_practitioner_assignments FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'option_menu_assignments'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON option_menu_assignments FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'admin_store_assignments'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON admin_store_assignments FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

-- Backfill from legacy array columns (if present).
INSERT INTO practitioner_store_assignments (tenant_id, practitioner_id, store_id)
SELECT p.tenant_id, p.id, sid.store_id
FROM practitioners p
CROSS JOIN LATERAL unnest(COALESCE(p.store_ids, '{}'::uuid[])) AS sid(store_id)
JOIN stores s
  ON s.tenant_id = p.tenant_id
 AND s.id = sid.store_id
ON CONFLICT DO NOTHING;

INSERT INTO menu_practitioner_assignments (tenant_id, menu_id, practitioner_id)
SELECT m.tenant_id, m.id, pid.practitioner_id
FROM menus m
CROSS JOIN LATERAL unnest(COALESCE(m.practitioner_ids, '{}'::uuid[])) AS pid(practitioner_id)
JOIN practitioners p
  ON p.tenant_id = m.tenant_id
 AND p.id = pid.practitioner_id
ON CONFLICT DO NOTHING;

INSERT INTO option_menu_assignments (tenant_id, option_id, menu_id)
SELECT o.tenant_id, o.id, mid.menu_id
FROM menu_options o
CROSS JOIN LATERAL unnest(COALESCE(o.applicable_menu_ids, '{}'::uuid[])) AS mid(menu_id)
JOIN menus m
  ON m.tenant_id = o.tenant_id
 AND m.id = mid.menu_id
ON CONFLICT DO NOTHING;

INSERT INTO admin_store_assignments (tenant_id, admin_id, store_id)
SELECT a.tenant_id, a.id, sid.store_id
FROM admins a
CROSS JOIN LATERAL unnest(COALESCE(a.store_ids, '{}'::uuid[])) AS sid(store_id)
JOIN stores s
  ON s.tenant_id = a.tenant_id
 AND s.id = sid.store_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4) Tenant-safe composite foreign keys
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tenant_store_fk_v3') THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_tenant_store_fk_v3
            FOREIGN KEY (tenant_id, store_id)
            REFERENCES stores(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tenant_customer_fk_v3') THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_tenant_customer_fk_v3
            FOREIGN KEY (tenant_id, customer_id)
            REFERENCES customers(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_tenant_practitioner_fk_v3') THEN
        ALTER TABLE reservations
            ADD CONSTRAINT reservations_tenant_practitioner_fk_v3
            FOREIGN KEY (tenant_id, practitioner_id)
            REFERENCES practitioners(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_menus_tenant_reservation_fk_v3') THEN
        ALTER TABLE reservation_menus
            ADD CONSTRAINT reservation_menus_tenant_reservation_fk_v3
            FOREIGN KEY (tenant_id, reservation_id)
            REFERENCES reservations(tenant_id, id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_menus_tenant_menu_fk_v3') THEN
        ALTER TABLE reservation_menus
            ADD CONSTRAINT reservation_menus_tenant_menu_fk_v3
            FOREIGN KEY (tenant_id, menu_id)
            REFERENCES menus(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_options_tenant_reservation_fk_v3') THEN
        ALTER TABLE reservation_options
            ADD CONSTRAINT reservation_options_tenant_reservation_fk_v3
            FOREIGN KEY (tenant_id, reservation_id)
            REFERENCES reservations(tenant_id, id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservation_options_tenant_option_fk_v3') THEN
        ALTER TABLE reservation_options
            ADD CONSTRAINT reservation_options_tenant_option_fk_v3
            FOREIGN KEY (tenant_id, option_id)
            REFERENCES menu_options(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kartes_tenant_customer_fk_v3') THEN
        ALTER TABLE kartes
            ADD CONSTRAINT kartes_tenant_customer_fk_v3
            FOREIGN KEY (tenant_id, customer_id)
            REFERENCES customers(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kartes_tenant_reservation_fk_v3') THEN
        ALTER TABLE kartes
            ADD CONSTRAINT kartes_tenant_reservation_fk_v3
            FOREIGN KEY (tenant_id, reservation_id)
            REFERENCES reservations(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kartes_tenant_store_fk_v3') THEN
        ALTER TABLE kartes
            ADD CONSTRAINT kartes_tenant_store_fk_v3
            FOREIGN KEY (tenant_id, store_id)
            REFERENCES stores(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kartes_tenant_practitioner_fk_v3') THEN
        ALTER TABLE kartes
            ADD CONSTRAINT kartes_tenant_practitioner_fk_v3
            FOREIGN KEY (tenant_id, practitioner_id)
            REFERENCES practitioners(tenant_id, id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'booking_link_tokens'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_link_tokens_tenant_store_fk_v3'
    ) THEN
        ALTER TABLE booking_link_tokens
            ADD CONSTRAINT booking_link_tokens_tenant_store_fk_v3
            FOREIGN KEY (tenant_id, store_id)
            REFERENCES stores(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'booking_link_tokens'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_link_tokens_tenant_practitioner_fk_v3'
    ) THEN
        ALTER TABLE booking_link_tokens
            ADD CONSTRAINT booking_link_tokens_tenant_practitioner_fk_v3
            FOREIGN KEY (tenant_id, practitioner_id)
            REFERENCES practitioners(tenant_id, id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'google_calendar_sync_tasks'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_sync_tasks_tenant_reservation_fk_v3'
    ) THEN
        ALTER TABLE google_calendar_sync_tasks
            ADD CONSTRAINT google_calendar_sync_tasks_tenant_reservation_fk_v3
            FOREIGN KEY (tenant_id, reservation_id)
            REFERENCES reservations(tenant_id, id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'service_message_logs'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'service_message_logs_tenant_reservation_fk_v3'
    ) THEN
        ALTER TABLE service_message_logs
            ADD CONSTRAINT service_message_logs_tenant_reservation_fk_v3
            FOREIGN KEY (tenant_id, reservation_id)
            REFERENCES reservations(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

-- Validate constraints after creation (idempotent guard by exception handling).
DO $$ BEGIN
    BEGIN
        ALTER TABLE reservations VALIDATE CONSTRAINT reservations_tenant_store_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservations VALIDATE CONSTRAINT reservations_tenant_customer_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservations VALIDATE CONSTRAINT reservations_tenant_practitioner_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservation_menus VALIDATE CONSTRAINT reservation_menus_tenant_reservation_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservation_menus VALIDATE CONSTRAINT reservation_menus_tenant_menu_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservation_options VALIDATE CONSTRAINT reservation_options_tenant_reservation_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE reservation_options VALIDATE CONSTRAINT reservation_options_tenant_option_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE kartes VALIDATE CONSTRAINT kartes_tenant_customer_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE kartes VALIDATE CONSTRAINT kartes_tenant_reservation_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE kartes VALIDATE CONSTRAINT kartes_tenant_store_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE kartes VALIDATE CONSTRAINT kartes_tenant_practitioner_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE booking_link_tokens VALIDATE CONSTRAINT booking_link_tokens_tenant_store_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE booking_link_tokens VALIDATE CONSTRAINT booking_link_tokens_tenant_practitioner_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE google_calendar_sync_tasks VALIDATE CONSTRAINT google_calendar_sync_tasks_tenant_reservation_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;

    BEGIN
        ALTER TABLE service_message_logs VALIDATE CONSTRAINT service_message_logs_tenant_reservation_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;
END $$;

-- ============================================================
-- 5) Export jobs infrastructure (CSV)
-- ============================================================
CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID,
    export_type VARCHAR(50) NOT NULL
        CHECK (export_type IN (
            'operations_reservations',
            'operations_customers',
            'analytics_store_daily_kpi',
            'analytics_menu_performance'
        )),
    format VARCHAR(10) NOT NULL DEFAULT 'csv'
        CHECK (format IN ('csv')),
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    requested_by TEXT,
    row_count INTEGER,
    csv_content TEXT,
    error_message TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'export_jobs_tenant_store_fk_v3'
    ) THEN
        ALTER TABLE export_jobs
            ADD CONSTRAINT export_jobs_tenant_store_fk_v3
            FOREIGN KEY (tenant_id, store_id)
            REFERENCES stores(tenant_id, id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        ALTER TABLE export_jobs VALIDATE CONSTRAINT export_jobs_tenant_store_fk_v3;
    EXCEPTION WHEN undefined_object THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant_status_requested
    ON export_jobs (tenant_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant_store_requested
    ON export_jobs (tenant_id, store_id, requested_at DESC);

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'export_jobs'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON export_jobs FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_export_jobs_updated_at'
    ) THEN
        CREATE TRIGGER update_export_jobs_updated_at
        BEFORE UPDATE ON export_jobs
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- ============================================================
-- 6) Enforce RLS and role safety
-- ============================================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    -- Exclude tenants/audit_logs from FORCE here: they include system-level workflows
    -- that intentionally run without a tenant-scoped context.
    FOREACH tbl IN ARRAY ARRAY[
        'stores',
        'practitioners',
        'menus',
        'menu_options',
        'customers',
        'reservations',
        'reservation_menus',
        'reservation_options',
        'kartes',
        'karte_templates',
        'admins',
        'daily_analytics',
        'settings',
        'service_message_logs',
        'booking_link_tokens',
        'google_calendar_sync_tasks',
        'practitioner_store_assignments',
        'menu_practitioner_assignments',
        'option_menu_assignments',
        'admin_store_assignments',
        'export_jobs'
    ] LOOP
        IF to_regclass(tbl) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE
    has_bypass BOOLEAN;
BEGIN
    SELECT rolbypassrls
    INTO has_bypass
    FROM pg_roles
    WHERE rolname = 'app_user';

    IF has_bypass IS NULL THEN
        RAISE EXCEPTION 'Required role app_user was not found';
    END IF;

    IF has_bypass THEN
        BEGIN
            ALTER ROLE app_user NOBYPASSRLS;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RAISE EXCEPTION USING
                    ERRCODE = '42501',
                    MESSAGE = 'app_user has BYPASSRLS but migration role cannot clear it',
                    HINT = 'Run ALTER ROLE app_user NOBYPASSRLS as a privileged role, then rerun migration.';
        END;
    END IF;

    SELECT rolbypassrls
    INTO has_bypass
    FROM pg_roles
    WHERE rolname = 'app_user';

    IF has_bypass THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'app_user must not have BYPASSRLS';
    END IF;
END $$;

COMMIT;
