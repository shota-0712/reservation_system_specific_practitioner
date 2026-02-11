-- ============================================================
-- Firestoreからのデータマイグレーション用スクリプト
-- Version: 1.0.1
-- Created: 2026-01-31
-- ============================================================

-- このスクリプトはFirestoreのデータをPostgreSQLに移行する際に使用します。
-- Node.jsマイグレーションスクリプトからデータを挿入する際に役立つヘルパー関数を定義します。

-- ============================================================
-- 1. 一時テーブル（バルクインサート用）
-- ============================================================

-- メイグレーション進捗管理
CREATE TABLE IF NOT EXISTS migration_progress (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    firestore_collection VARCHAR(100) NOT NULL,
    total_count INTEGER DEFAULT 0,
    migrated_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    last_document_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- マイグレーションエラーログ
CREATE TABLE IF NOT EXISTS migration_errors (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    firestore_document_id VARCHAR(255) NOT NULL,
    firestore_data JSONB,
    error_message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Firestore ID → PostgreSQL UUID マッピング
-- ============================================================

-- Firestore document ID と PostgreSQL UUID のマッピングを保存
-- これにより、リレーション再構築時に参照可能
CREATE TABLE IF NOT EXISTS id_mappings (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    firestore_id VARCHAR(255) NOT NULL,
    postgres_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, firestore_id)
);

CREATE INDEX IF NOT EXISTS idx_id_mappings_firestore ON id_mappings (entity_type, firestore_id);
CREATE INDEX IF NOT EXISTS idx_id_mappings_postgres ON id_mappings (entity_type, postgres_id);

-- ============================================================
-- 3. ヘルパー関数
-- ============================================================

-- Firestore ID から PostgreSQL UUID を取得
CREATE OR REPLACE FUNCTION get_postgres_id(
    p_entity_type VARCHAR(50),
    p_firestore_id VARCHAR(255)
) RETURNS UUID AS $$
DECLARE
    v_postgres_id UUID;
BEGIN
    SELECT postgres_id INTO v_postgres_id
    FROM id_mappings
    WHERE entity_type = p_entity_type AND firestore_id = p_firestore_id;
    
    RETURN v_postgres_id;
END;
$$ LANGUAGE plpgsql;

-- 新しいマッピングを登録
CREATE OR REPLACE FUNCTION register_id_mapping(
    p_entity_type VARCHAR(50),
    p_firestore_id VARCHAR(255),
    p_postgres_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_postgres_id UUID;
BEGIN
    v_postgres_id := COALESCE(p_postgres_id, uuid_generate_v4());
    
    INSERT INTO id_mappings (entity_type, firestore_id, postgres_id)
    VALUES (p_entity_type, p_firestore_id, v_postgres_id)
    ON CONFLICT (entity_type, firestore_id) DO UPDATE SET
        postgres_id = EXCLUDED.postgres_id;
    
    RETURN v_postgres_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. 日時変換関数
-- ============================================================

-- Firestore Timestamp（ミリ秒）をPostgreSQL TIMESTAMPTZに変換
CREATE OR REPLACE FUNCTION firestore_timestamp_to_timestamptz(
    p_seconds BIGINT,
    p_nanos INTEGER DEFAULT 0
) RETURNS TIMESTAMPTZ AS $$
BEGIN
    IF p_seconds IS NULL THEN
        RETURN NULL;
    END IF;
    
    RETURN to_timestamp(p_seconds + p_nanos::numeric / 1000000000);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. 予約期間作成関数
-- ============================================================

-- 日付と開始・終了時刻からTSTZRANGEを作成
CREATE OR REPLACE FUNCTION create_reservation_period(
    p_date DATE,
    p_start_time VARCHAR(5),  -- "10:00"
    p_end_time VARCHAR(5)      -- "11:30"
) RETURNS TSTZRANGE AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
BEGIN
    v_start := (p_date::text || ' ' || p_start_time || ':00')::TIMESTAMPTZ AT TIME ZONE 'Asia/Tokyo';
    v_end := (p_date::text || ' ' || p_end_time || ':00')::TIMESTAMPTZ AT TIME ZONE 'Asia/Tokyo';
    
    RETURN tstzrange(v_start, v_end, '[)');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. マイグレーション進捗更新関数
-- ============================================================

CREATE OR REPLACE FUNCTION update_migration_progress(
    p_entity_type VARCHAR(50),
    p_status VARCHAR(20),
    p_migrated_count INTEGER DEFAULT NULL,
    p_failed_count INTEGER DEFAULT NULL,
    p_last_document_id VARCHAR(255) DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE migration_progress
    SET 
        status = p_status,
        migrated_count = COALESCE(p_migrated_count, migrated_count),
        failed_count = COALESCE(p_failed_count, failed_count),
        last_document_id = COALESCE(p_last_document_id, last_document_id),
        error_message = p_error_message,
        completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE entity_type = p_entity_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. マイグレーション検証クエリ
-- ============================================================

-- マイグレーション後のデータ検証用ビュー
CREATE OR REPLACE VIEW migration_summary AS
SELECT
    entity_type,
    firestore_collection,
    total_count,
    migrated_count,
    failed_count,
    ROUND((migrated_count::numeric / NULLIF(total_count, 0)) * 100, 2) as success_rate,
    status,
    started_at,
    completed_at,
    completed_at - started_at as duration,
    error_message
FROM migration_progress
ORDER BY started_at DESC;

-- テーブルごとのレコード数確認
CREATE OR REPLACE VIEW table_counts AS
SELECT 'tenants' as table_name, COUNT(*) as count FROM tenants
UNION ALL SELECT 'stores', COUNT(*) FROM stores
UNION ALL SELECT 'practitioners', COUNT(*) FROM practitioners
UNION ALL SELECT 'menus', COUNT(*) FROM menus
UNION ALL SELECT 'menu_options', COUNT(*) FROM menu_options
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'reservations', COUNT(*) FROM reservations
UNION ALL SELECT 'reservation_menus', COUNT(*) FROM reservation_menus
UNION ALL SELECT 'kartes', COUNT(*) FROM kartes
UNION ALL SELECT 'admins', COUNT(*) FROM admins
UNION ALL SELECT 'settings', COUNT(*) FROM settings
ORDER BY table_name;

-- ============================================================
-- 8. クリーンアップ関数（マイグレーション完了後）
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_migration_tables()
RETURNS VOID AS $$
BEGIN
    -- マイグレーション用テーブルを削除
    DROP TABLE IF EXISTS migration_progress CASCADE;
    DROP TABLE IF EXISTS migration_errors CASCADE;
    -- id_mappingsは念のため残す（将来の参照用）
    
    -- 関数の削除
    DROP FUNCTION IF EXISTS get_postgres_id;
    DROP FUNCTION IF EXISTS register_id_mapping;
    DROP FUNCTION IF EXISTS firestore_timestamp_to_timestamptz;
    DROP FUNCTION IF EXISTS create_reservation_period;
    DROP FUNCTION IF EXISTS update_migration_progress;
    
    -- ビューの削除
    DROP VIEW IF EXISTS migration_summary;
    DROP VIEW IF EXISTS table_counts;
    
    RAISE NOTICE 'マイグレーション用テーブルのクリーンアップが完了しました';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 完了メッセージ
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE 'マイグレーションヘルパーのセットアップが完了しました';
    RAISE NOTICE '確認: SELECT * FROM migration_summary;';
    RAISE NOTICE '確認: SELECT * FROM table_counts;';
END
$$;
