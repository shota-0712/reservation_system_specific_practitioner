-- ============================================================
-- Schema Migration v2.4 -> v2.5 (Schema Migrations Table)
-- Focus: migration適用履歴をDBで管理
-- Created: 2026-02-09
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_migrations_filename
    ON schema_migrations (filename);

COMMIT;
