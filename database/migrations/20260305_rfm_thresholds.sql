-- CRM-BE-001: tenant_rfm_settings テーブル追加
-- テナントごとのRFM閾値設定を保持する。未設定テナントはサービス層のデフォルト値を使用。
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_rfm_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    -- Recency: 直近来店からの日数（小さいほど良い）
    recency_score5  INTEGER NOT NULL DEFAULT 30,   -- score5 ≤ N days
    recency_score4  INTEGER NOT NULL DEFAULT 60,
    recency_score3  INTEGER NOT NULL DEFAULT 90,
    recency_score2  INTEGER NOT NULL DEFAULT 180,
    -- Frequency: 来店回数（大きいほど良い）
    frequency_score5 INTEGER NOT NULL DEFAULT 12,  -- score5 ≥ N visits
    frequency_score4 INTEGER NOT NULL DEFAULT 8,
    frequency_score3 INTEGER NOT NULL DEFAULT 4,
    frequency_score2 INTEGER NOT NULL DEFAULT 2,
    -- Monetary: 累計購入額（大きいほど良い）
    monetary_score5  INTEGER NOT NULL DEFAULT 100000, -- score5 ≥ N yen
    monetary_score4  INTEGER NOT NULL DEFAULT 50000,
    monetary_score3  INTEGER NOT NULL DEFAULT 20000,
    monetary_score2  INTEGER NOT NULL DEFAULT 10000,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by      TEXT
);

-- RLS: テナント分離
ALTER TABLE tenant_rfm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_rfm_settings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

COMMENT ON TABLE tenant_rfm_settings IS 'Per-tenant RFM scoring thresholds. Missing row = use service defaults.';

COMMIT;
