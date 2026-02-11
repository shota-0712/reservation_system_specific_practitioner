-- ============================================================
-- Schema Migration v2.2 -> v2.3 (Unification Core)
-- Focus: notification token columns / schedule shape support / audit + analytics indexes
-- Created: 2026-02-09
-- ============================================================

BEGIN;

-- 1) customers: dedicated notification token columns
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS line_notification_token TEXT;

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS line_notification_token_expires_at TIMESTAMPTZ;

-- backfill from legacy attributes.notificationToken if present
UPDATE customers
SET line_notification_token = COALESCE(line_notification_token, attributes ->> 'notificationToken')
WHERE line_notification_token IS NULL
  AND attributes ? 'notificationToken';

CREATE INDEX IF NOT EXISTS idx_customers_line_notification_token
    ON customers (tenant_id, line_notification_token)
    WHERE line_notification_token IS NOT NULL;

-- 2) practitioners: keep work_schedule JSONB but ensure it is always object and add update hint fields
ALTER TABLE practitioners
    ALTER COLUMN work_schedule SET DEFAULT '{}'::jsonb;

UPDATE practitioners
SET work_schedule = '{}'::jsonb
WHERE work_schedule IS NULL;

-- 3) audit_logs: actor_id text support for Firebase UID / LINE user id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'audit_logs' AND column_name = 'actor_id' AND data_type = 'uuid'
    ) THEN
        ALTER TABLE audit_logs
            ALTER COLUMN actor_id TYPE TEXT USING actor_id::text;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action
    ON audit_logs (tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs (tenant_id, actor_type, actor_id, created_at DESC);

-- 4) daily_analytics: aggregation friendly indexes
CREATE INDEX IF NOT EXISTS idx_daily_analytics_tenant_store_date
    ON daily_analytics (tenant_id, store_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_analytics_tenant_created_at
    ON daily_analytics (tenant_id, created_at DESC);

-- 5) google oauth table helpful index
CREATE INDEX IF NOT EXISTS idx_tenant_google_calendar_oauth_status
    ON tenant_google_calendar_oauth (tenant_id, status);

COMMIT;
