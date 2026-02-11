-- ============================================================
-- Schema Migration v2.3 -> v2.4 (Daily Analytics Breakdowns)
-- Focus: reports API を daily_analytics ベースへ寄せるための内訳カラム追加
-- Created: 2026-02-09
-- ============================================================

BEGIN;

ALTER TABLE daily_analytics
    ADD COLUMN IF NOT EXISTS reservations_count_by_menu JSONB DEFAULT '{}'::jsonb;

ALTER TABLE daily_analytics
    ADD COLUMN IF NOT EXISTS unique_customers_by_practitioner JSONB DEFAULT '{}'::jsonb;

UPDATE daily_analytics
SET reservations_count_by_menu = '{}'::jsonb
WHERE reservations_count_by_menu IS NULL;

UPDATE daily_analytics
SET unique_customers_by_practitioner = '{}'::jsonb
WHERE unique_customers_by_practitioner IS NULL;

ALTER TABLE daily_analytics
    ALTER COLUMN reservations_count_by_menu SET DEFAULT '{}'::jsonb;

ALTER TABLE daily_analytics
    ALTER COLUMN unique_customers_by_practitioner SET DEFAULT '{}'::jsonb;

COMMIT;
