-- ============================================================
-- Schema Migration v2.5 -> v2.6 (Google Calendar Sync Queue)
-- Focus: Google Calendar 同期失敗時の補償キュー（再試行）
-- Created: 2026-02-09
-- ============================================================

BEGIN;

-- 1) reservations: calendar id snapshot (eventId だけだと削除/更新先カレンダーが特定できないため)
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS google_calendar_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_reservations_google_calendar_ref
    ON reservations (tenant_id, google_calendar_id, google_calendar_event_id)
    WHERE google_calendar_event_id IS NOT NULL;

-- 2) sync queue tasks
CREATE TABLE IF NOT EXISTS google_calendar_sync_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,

    action VARCHAR(20) NOT NULL
        CHECK (action IN ('create', 'update', 'delete')),

    -- Event location information (best-effort; reservation snapshot may be used as fallback)
    calendar_id VARCHAR(255),
    event_id VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    succeeded_at TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_tasks_tenant_status_next
    ON google_calendar_sync_tasks (tenant_id, status, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_tasks_reservation
    ON google_calendar_sync_tasks (reservation_id, created_at DESC);

-- Prevent unbounded duplicate tasks for the same reservation/action while pending.
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_calendar_sync_tasks_dedupe
    ON google_calendar_sync_tasks (tenant_id, reservation_id, action)
    WHERE status IN ('pending', 'running');

-- Trigger: updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_google_calendar_sync_tasks_updated_at'
    ) THEN
        CREATE TRIGGER update_google_calendar_sync_tasks_updated_at BEFORE UPDATE ON google_calendar_sync_tasks
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- RLS
ALTER TABLE google_calendar_sync_tasks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'google_calendar_sync_tasks'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON google_calendar_sync_tasks FOR ALL
            USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
            WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
    END IF;
END $$;

COMMIT;

