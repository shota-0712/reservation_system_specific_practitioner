-- ============================================================
-- Export Jobs: GCS storage metadata for signed URL delivery
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS storage_type VARCHAR(20) NOT NULL DEFAULT 'inline';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'export_jobs_storage_type_check'
    ) THEN
        ALTER TABLE export_jobs
            ADD CONSTRAINT export_jobs_storage_type_check
            CHECK (storage_type IN ('inline', 'gcs'));
    END IF;
END $$;

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS gcs_bucket TEXT;

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS gcs_object_path TEXT;

ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS download_url_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_export_jobs_storage_type
    ON export_jobs (tenant_id, storage_type, requested_at DESC);

COMMIT;
