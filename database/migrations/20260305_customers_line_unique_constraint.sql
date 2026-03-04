-- Fix: customers に (tenant_id, line_user_id) の UNIQUE 制約を追加
-- INSERT ... ON CONFLICT DO UPDATE (findOrCreate の原子的 upsert) に必要
BEGIN;

DO $$ BEGIN
    ALTER TABLE customers
        ADD CONSTRAINT customers_tenant_line_user_unique
        UNIQUE (tenant_id, line_user_id);
EXCEPTION WHEN duplicate_table THEN
    NULL;
END $$;

-- 既存の通常インデックス idx_customers_line は重複となるため削除
DROP INDEX IF EXISTS idx_customers_line;

COMMIT;
