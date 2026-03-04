-- Fix: set_tenant() を is_local=true（トランザクションローカル）に変更
-- false のままだとコネクションプール再利用時にテナントIDが漏洩する
BEGIN;

CREATE OR REPLACE FUNCTION set_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_tenant_local も同様に統一
CREATE OR REPLACE FUNCTION set_tenant_local(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
