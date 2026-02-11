-- ============================================================
-- Schema Migration v2.0 -> v2.1 (Cloud SQL)
-- Focus: store_code移管 / canceled表記統一 / 集計カラム名変更
-- Created: 2026-01-31
-- ============================================================

BEGIN;

-- 1) stores.store_code 追加（nullableで先に追加）
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_code VARCHAR(10);

-- 2) tenants.store_code から初期値を移管（存在する場合）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'store_code'
    ) THEN
        WITH ranked AS (
            SELECT id, tenant_id,
                   row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
            FROM stores
        )
        UPDATE stores s
        SET store_code = t.store_code
        FROM tenants t
        JOIN ranked r ON r.tenant_id = t.id
        WHERE r.id = s.id
          AND r.rn = 1
          AND s.store_code IS NULL
          AND t.store_code IS NOT NULL;
    END IF;
END $$;

-- 3) store_code 自動生成（未設定分）
CREATE OR REPLACE FUNCTION generate_store_code(len int DEFAULT 8)
RETURNS text AS $$
DECLARE
    chars text := 'abcdefghjkmnpqrstuvwxyz23456789';
    result text := '';
    i int;
BEGIN
    FOR i IN 1..len LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_unique_store_code()
RETURNS text AS $$
DECLARE
    code text;
BEGIN
    LOOP
        code := generate_store_code(8);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM stores WHERE store_code = code);
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

UPDATE stores
SET store_code = generate_unique_store_code()
WHERE store_code IS NULL;

-- 4) store_code 制約追加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stores_store_code_format'
    ) THEN
        ALTER TABLE stores
        ADD CONSTRAINT stores_store_code_format
        CHECK (store_code ~ '^[a-z0-9]{8,10}$');
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='stores' AND column_name='store_code' AND is_nullable='YES'
    ) THEN
        ALTER TABLE stores ALTER COLUMN store_code SET NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stores_store_code_key'
    ) THEN
        ALTER TABLE stores ADD CONSTRAINT stores_store_code_key UNIQUE (store_code);
    END IF;
END $$;

-- 5) reservations: statusの表記統一
UPDATE reservations SET status = 'canceled' WHERE status = 'cancelled';

-- 6) reservations: cancelled_* -> canceled_* へリネーム
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='reservations' AND column_name='cancelled_at'
    ) THEN
        ALTER TABLE reservations RENAME COLUMN cancelled_at TO canceled_at;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='reservations' AND column_name='cancelled_by'
    ) THEN
        ALTER TABLE reservations RENAME COLUMN cancelled_by TO canceled_by;
    END IF;
END $$;

-- 7) reservations: CHECK制約更新
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations
    ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show'));

-- 8) reservations: 排他制約更新
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'reservations'::regclass AND contype = 'x'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE reservations DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE reservations
    ADD CONSTRAINT reservations_no_overlap
    EXCLUDE USING GIST (
        tenant_id WITH =,
        practitioner_id WITH =,
        period WITH &&
    ) WHERE (status NOT IN ('canceled', 'no_show'));

-- 9) daily_analytics: cancelled_count -> canceled_count
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='daily_analytics' AND column_name='cancelled_count'
    ) THEN
        ALTER TABLE daily_analytics RENAME COLUMN cancelled_count TO canceled_count;
    END IF;
END $$;

-- 9.5) practitioners: role追加
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'stylist';
ALTER TABLE practitioners DROP CONSTRAINT IF EXISTS practitioners_role_check;
ALTER TABLE practitioners
    ADD CONSTRAINT practitioners_role_check
    CHECK (role IN ('stylist', 'assistant', 'owner'));
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#3b82f6';

-- 9.6) customers: cancel/no_show カウント追加
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cancel_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0;

-- 10) tenants.store_code削除（移行後）
DROP INDEX IF EXISTS idx_tenants_store_code;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tenants' AND column_name='store_code'
    ) THEN
        ALTER TABLE tenants DROP COLUMN store_code;
    END IF;
END $$;

COMMIT;
