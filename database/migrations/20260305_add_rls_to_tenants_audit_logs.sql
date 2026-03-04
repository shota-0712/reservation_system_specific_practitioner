-- Fix: tenants / audit_logs テーブルへの RLS 追加
-- これらのテーブルが RLS 未適用のため app_user が全テナントデータを参照できる

BEGIN;

-- ============================================================
-- tenants テーブル
-- tenant_id カラムは存在しないため id で自テナントのみ絞り込む
-- ============================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- app_user は自テナントのみ SELECT 可能
CREATE POLICY tenant_isolation ON tenants
    FOR ALL
    USING (id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- audit_logs テーブル
-- tenant_id カラムは NULLABLE（システムイベントは NULL になり得る）
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- app_user は自テナントのログのみ参照可能（tenant_id が NULL の行は除外）
CREATE POLICY tenant_isolation ON audit_logs
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

COMMIT;
