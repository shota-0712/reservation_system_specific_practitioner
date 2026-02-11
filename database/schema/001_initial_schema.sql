-- ============================================================
-- マルチテナント予約・CRMシステム PostgreSQLスキーマ
-- Version: 2.1.0  (改訂版 - 全機能対応)
-- Created: 2026-01-31
-- ============================================================

-- 拡張機能のインストール
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- 排他制約に必要
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- テキスト検索用

-- ============================================================
-- 1. テナント（企業）テーブル
-- ============================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 識別子
    slug VARCHAR(50) UNIQUE NOT NULL,           -- 管理画面URL用 (salon-group-a)
    
    -- 基本情報
    name VARCHAR(200) NOT NULL,                 -- 企業名
    
    -- プランと状態
    plan VARCHAR(20) NOT NULL DEFAULT 'trial'
        CHECK (plan IN ('free', 'trial', 'basic', 'pro', 'enterprise')),
    status VARCHAR(20) NOT NULL DEFAULT 'trial'
        CHECK (status IN ('active', 'trial', 'suspended', 'canceled')),
    
    -- LINE設定（暗号化して保存）
    line_liff_id VARCHAR(50),
    line_channel_id VARCHAR(50),
    line_channel_access_token_encrypted TEXT,
    line_channel_secret_encrypted TEXT,
    
    -- ブランディング
    branding_primary_color VARCHAR(7) DEFAULT '#4F46E5',
    branding_logo_url TEXT,
    branding_favicon_url TEXT,
    
    -- Stripe連携
    stripe_customer_id VARCHAR(100),
    subscription_current_period_end TIMESTAMPTZ,
    max_stores INTEGER DEFAULT 1,
    max_practitioners INTEGER DEFAULT 5,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);

-- ============================================================
-- 2. テナントGoogle Calendar OAuth設定
-- ============================================================
CREATE TABLE tenant_google_calendar_oauth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    
    -- OAuth情報（暗号化）
    refresh_token_encrypted TEXT NOT NULL,
    scope TEXT NOT NULL,
    email VARCHAR(255),                         -- 連携したGoogleアカウント
    
    -- 状態
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked')),
    
    -- Channel情報（Push通知用）
    channel_ids JSONB DEFAULT '[]',            -- 施術者ごとのChannel ID
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ
);

-- ============================================================
-- 3. テナントサロンボード連携設定
-- ============================================================
CREATE TABLE tenant_salonboard_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    
    -- 認証情報（暗号化）
    username_encrypted TEXT,
    password_encrypted TEXT,
    session_cookie_encrypted TEXT,
    
    -- 同期設定
    is_enabled BOOLEAN DEFAULT false,
    sync_direction VARCHAR(20) DEFAULT 'both'
        CHECK (sync_direction IN ('inbound', 'outbound', 'both')),
    
    -- 状態
    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(20),              -- success, error
    last_sync_error TEXT,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. 店舗テーブル
-- ============================================================
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 基本情報
    name VARCHAR(100) NOT NULL,
    store_code VARCHAR(10) UNIQUE NOT NULL
        CHECK (store_code ~ '^[a-z0-9]{8,10}$'),   -- 顧客向けURL用 (a7x9m2k5)
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(255),
    timezone VARCHAR(50) DEFAULT 'Asia/Tokyo',
    
    -- 営業時間 (JSONB)
    business_hours JSONB DEFAULT '{
        "0": {"isOpen": false},
        "1": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "2": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "3": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "4": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "5": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "6": {"isOpen": true, "openTime": "10:00", "closeTime": "19:00"}
    }',
    
    -- 休日設定
    regular_holidays INTEGER[] DEFAULT '{}',        -- 定休曜日
    temporary_holidays DATE[] DEFAULT '{}',         -- 臨時休業日
    temporary_open_days DATE[] DEFAULT '{}',        -- 臨時営業日
    
    -- 予約設定
    slot_duration INTEGER DEFAULT 30,               -- 分
    advance_booking_days INTEGER DEFAULT 30,        -- 何日先まで予約可能
    cancel_deadline_hours INTEGER DEFAULT 24,       -- キャンセル期限
    require_phone BOOLEAN DEFAULT true,
    require_email BOOLEAN DEFAULT false,
    
    -- 状態
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    display_order INTEGER DEFAULT 0,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stores_tenant ON stores (tenant_id);

-- RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stores FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 5. 施術者（スタッフ）テーブル
-- ============================================================
CREATE TABLE practitioners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 基本情報
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'stylist'
        CHECK (role IN ('stylist', 'assistant', 'owner')),
    name_kana VARCHAR(100),
    title VARCHAR(50),                              -- スタイリスト、オーナー等
    color VARCHAR(7) DEFAULT '#3b82f6',
    image_url TEXT,
    description TEXT,
    experience VARCHAR(50),                         -- 経験10年
    
    -- PR情報（Customer App用）
    pr_title VARCHAR(200),                          -- PRタイトル
    specialties TEXT[] DEFAULT '{}',                -- 得意分野
    
    -- SNS
    sns_instagram VARCHAR(100),
    sns_twitter VARCHAR(100),
    
    -- Google Calendar連携
    google_calendar_id VARCHAR(255),
    
    -- サロンボード連携
    salonboard_staff_id VARCHAR(100),               -- サロンボード側のスタッフID
    
    -- 料金
    nomination_fee INTEGER DEFAULT 0,               -- 指名料
    
    -- 勤務スケジュール (JSONB)
    work_schedule JSONB DEFAULT '{
        "0": {"isWorking": false},
        "1": {"isWorking": true, "startTime": "10:00", "endTime": "20:00"},
        "2": {"isWorking": true, "startTime": "10:00", "endTime": "20:00"},
        "3": {"isWorking": true, "startTime": "10:00", "endTime": "20:00"},
        "4": {"isWorking": true, "startTime": "10:00", "endTime": "20:00"},
        "5": {"isWorking": true, "startTime": "10:00", "endTime": "20:00"},
        "6": {"isWorking": true, "startTime": "10:00", "endTime": "19:00"}
    }',
    
    -- 所属店舗
    store_ids UUID[] DEFAULT '{}',
    
    -- 状態
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_practitioners_tenant ON practitioners (tenant_id);
CREATE INDEX idx_practitioners_active ON practitioners (tenant_id, is_active, display_order);

-- RLS
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON practitioners FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 6. メニューテーブル
-- ============================================================
CREATE TABLE menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 基本情報
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    
    -- 料金・時間
    price INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 30,           -- 分
    
    -- 表示設定
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    -- 対応可能施術者（空＝全員対応可）
    practitioner_ids UUID[] DEFAULT '{}',
    
    -- カスタム属性
    attributes JSONB DEFAULT '{}',
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menus_tenant ON menus (tenant_id);
CREATE INDEX idx_menus_active ON menus (tenant_id, is_active, display_order);
CREATE INDEX idx_menus_category ON menus (tenant_id, category, display_order);

-- RLS
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menus FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 7. オプションテーブル
-- ============================================================
CREATE TABLE menu_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    duration INTEGER DEFAULT 0,                     -- 追加時間（分）
    
    -- 適用可能メニュー（空=全メニュー）
    applicable_menu_ids UUID[] DEFAULT '{}',
    
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_options_tenant ON menu_options (tenant_id);
CREATE INDEX idx_menu_options_applicable_menus ON menu_options USING GIN (applicable_menu_ids);

-- RLS
ALTER TABLE menu_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_options FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 8. 顧客テーブル（CRM - 拡張版）
-- ============================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 基本情報（固定カラム）
    name VARCHAR(100) NOT NULL,
    name_kana VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    
    -- LINE連携
    line_user_id VARCHAR(50),
    line_display_name VARCHAR(100),
    line_picture_url TEXT,
    
    -- 詳細プロファイル
    birthday DATE,
    gender VARCHAR(10),                             -- male, female, other
    
    -- 美容室特有プロファイル
    hair_type VARCHAR(50),                          -- せ毛、直毛等
    scalp_condition VARCHAR(50),                    -- 乾燥、脂性等
    
    -- 注意事項
    allergies TEXT[] DEFAULT '{}',                  -- アレルギー
    medical_notes TEXT,                             -- 医療メモ
    preferences TEXT,                               -- 好み・苦手
    
    -- アンケート結果（JSONB）
    questionnaire JSONB DEFAULT '{}',
    -- 例: {"来店きっかけ": "Instagram", "髪の悩み": "パサつき"}
    
    -- 集計値（非正規化・定期更新）
    total_visits INTEGER DEFAULT 0,
    total_spend DECIMAL(12, 2) DEFAULT 0,
    average_spend DECIMAL(12, 2) DEFAULT 0,
    cancel_count INTEGER DEFAULT 0,
    no_show_count INTEGER DEFAULT 0,
    last_visit_at TIMESTAMPTZ,
    first_visit_at TIMESTAMPTZ,
    favorite_menu_id UUID,
    favorite_practitioner_id UUID,
    
    -- RFM分析
    rfm_recency_score INTEGER,                      -- 1-5
    rfm_frequency_score INTEGER,                    -- 1-5
    rfm_monetary_score INTEGER,                     -- 1-5
    rfm_segment VARCHAR(20),                        -- VIP, Regular, AtRisk, etc.
    
    -- カスタムフィールド（店舗固有）
    attributes JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    
    -- 状態
    is_active BOOLEAN DEFAULT true,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_tenant ON customers (tenant_id);
CREATE INDEX idx_customers_phone ON customers (tenant_id, phone);
CREATE INDEX idx_customers_email ON customers (tenant_id, email);
CREATE INDEX idx_customers_line ON customers (tenant_id, line_user_id);
CREATE INDEX idx_customers_rfm ON customers (tenant_id, rfm_segment);
CREATE INDEX idx_customers_attributes ON customers USING GIN (attributes);
CREATE INDEX idx_customers_tags ON customers USING GIN (tags);
CREATE INDEX idx_customers_name_search ON customers USING GIN (name gin_trgm_ops);

-- RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 9. 予約テーブル
-- ============================================================
CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 関連
    store_id UUID REFERENCES stores(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    practitioner_id UUID NOT NULL REFERENCES practitioners(id),
    
    -- 日時（範囲型で二重予約防止）
    period TSTZRANGE NOT NULL,
    -- 便利用カラム（アプリケーション側で設定）
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    -- ステータス
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),
    
    -- 予約元
    source VARCHAR(20) DEFAULT 'line'
        CHECK (source IN ('line', 'phone', 'walk_in', 'salonboard', 'hotpepper', 'web', 'admin', 'google_calendar')),
    
    -- 外部連携ID
    google_calendar_event_id VARCHAR(255),          -- Google Calendar イベントID
    salonboard_reservation_id VARCHAR(255),         -- サロンボード予約ID
    
    -- 料金
    subtotal INTEGER DEFAULT 0,
    option_total INTEGER DEFAULT 0,
    nomination_fee INTEGER DEFAULT 0,
    discount INTEGER DEFAULT 0,
    total_price INTEGER DEFAULT 0,
    
    -- 所要時間
    total_duration INTEGER DEFAULT 0,               -- 分
    
    -- 顧客情報スナップショット（表示用・非正規化）
    customer_name VARCHAR(100),
    customer_phone VARCHAR(20),
    practitioner_name VARCHAR(100),
    
    -- カスタム属性
    notes TEXT,
    internal_note TEXT,                             -- 管理者用内部メモ
    attributes JSONB DEFAULT '{}',
    
    -- キャンセル情報
    canceled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    canceled_by VARCHAR(20),                        -- customer, admin

    -- リマインダー送信履歴
    reminder_sent_at TIMESTAMPTZ,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- ★★★ 排他制約：二重予約の完全防止 ★★★
    EXCLUDE USING GIST (
        tenant_id WITH =,
        practitioner_id WITH =,
        period WITH &&
    ) WHERE (status NOT IN ('canceled', 'no_show'))
);

-- インデックス
CREATE INDEX idx_reservations_tenant ON reservations (tenant_id);
CREATE INDEX idx_reservations_date ON reservations (tenant_id, date);
CREATE INDEX idx_reservations_customer ON reservations (tenant_id, customer_id);
CREATE INDEX idx_reservations_practitioner ON reservations (tenant_id, practitioner_id, date);
CREATE INDEX idx_reservations_status ON reservations (tenant_id, status, date);
CREATE INDEX idx_reservations_period ON reservations USING GIST (tenant_id, period);
CREATE INDEX idx_reservations_google_calendar ON reservations (tenant_id, google_calendar_event_id);
CREATE INDEX idx_reservations_salonboard ON reservations (tenant_id, salonboard_reservation_id);

-- RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 10. 予約メニュー中間テーブル
-- ============================================================
CREATE TABLE reservation_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    menu_id UUID NOT NULL REFERENCES menus(id),
    
    -- スナップショット（予約時点の値を保存）
    menu_name VARCHAR(100) NOT NULL,
    menu_price INTEGER NOT NULL,
    menu_duration INTEGER NOT NULL,
    
    -- 順序（メインメニュー=0、追加メニュー=1,2,...）
    sort_order INTEGER DEFAULT 0,
    is_main BOOLEAN DEFAULT false,                  -- メインメニューフラグ
    
    quantity INTEGER DEFAULT 1,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reservation_menus_reservation ON reservation_menus (reservation_id);
CREATE INDEX idx_reservation_menus_tenant ON reservation_menus (tenant_id);

-- RLS
ALTER TABLE reservation_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservation_menus FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 11. 予約オプション中間テーブル
-- ============================================================
CREATE TABLE reservation_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES menu_options(id),
    
    -- スナップショット
    option_name VARCHAR(100) NOT NULL,
    option_price INTEGER NOT NULL,
    option_duration INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reservation_options_reservation ON reservation_options (reservation_id);
CREATE INDEX idx_reservation_options_tenant ON reservation_options (tenant_id);

-- RLS
ALTER TABLE reservation_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservation_options FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 12. カルテ（施術記録）テーブル ★★★ 新規追加 ★★★
-- ============================================================
CREATE TABLE kartes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- 関連
    customer_id UUID NOT NULL REFERENCES customers(id),
    reservation_id UUID REFERENCES reservations(id),
    store_id UUID REFERENCES stores(id),
    practitioner_id UUID NOT NULL REFERENCES practitioners(id),
    
    -- 顧客情報スナップショット
    customer_name VARCHAR(100),
    customer_picture_url TEXT,
    
    -- 施術情報
    visit_date DATE NOT NULL,
    menu_ids UUID[] DEFAULT '{}',
    menu_names TEXT[] DEFAULT '{}',
    option_ids UUID[] DEFAULT '{}',
    duration INTEGER,                               -- 施術時間（分）
    total_amount INTEGER,                           -- 合計金額
    
    -- カルテ詳細
    treatment_description TEXT,                     -- 施術内容の詳細
    color_formula TEXT,                             -- カラー配合（美容室向け）
    products_used TEXT[] DEFAULT '{}',              -- 使用した商品・薬剤
    
    customer_request TEXT,                          -- 顧客の要望
    conversation_memo TEXT,                         -- 会話メモ
    next_visit_note TEXT,                           -- 次回への申し送り
    
    -- フリーフォーム項目（テンプレート拡張用）
    custom_fields JSONB DEFAULT '{}',
    
    -- 写真
    photos_before TEXT[] DEFAULT '{}',              -- ビフォー写真URL配列
    photos_after TEXT[] DEFAULT '{}',               -- アフター写真URL配列
    photos_other JSONB DEFAULT '[]',                -- その他写真 [{url, caption, type}]
    
    -- メタ情報
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'completed')),
    tags TEXT[] DEFAULT '{}',
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID                                 -- 施術者ID
);

CREATE INDEX idx_kartes_tenant ON kartes (tenant_id);
CREATE INDEX idx_kartes_customer ON kartes (tenant_id, customer_id, visit_date DESC);
CREATE INDEX idx_kartes_reservation ON kartes (reservation_id);
CREATE INDEX idx_kartes_date ON kartes (tenant_id, visit_date DESC);
CREATE INDEX idx_kartes_tags ON kartes USING GIN (tags);

-- RLS
ALTER TABLE kartes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kartes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 13. カルテテンプレートテーブル ★★★ 新規追加 ★★★
-- ============================================================
CREATE TABLE karte_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    
    -- テンプレート項目
    fields JSONB NOT NULL DEFAULT '[]',
    -- 例: [
    --   {"key": "cut_style", "label": "カットスタイル", "type": "text", "required": false},
    --   {"key": "color_formula", "label": "カラー配合", "type": "textarea", "required": false}
    -- ]
    
    -- 適用対象
    applicable_menu_categories TEXT[] DEFAULT '{}',
    
    -- 状態
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_karte_templates_tenant ON karte_templates (tenant_id);

-- RLS
ALTER TABLE karte_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON karte_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 14. 管理者テーブル
-- ============================================================
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Firebase Auth連携
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    
    -- 基本情報
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    
    -- LINE連携（オプション）
    line_user_id VARCHAR(50),
    
    -- 権限
    role VARCHAR(20) NOT NULL DEFAULT 'staff'
        CHECK (role IN ('owner', 'admin', 'manager', 'staff')),
    
    -- 詳細権限
    permissions JSONB DEFAULT '{
        "manageMenus": false,
        "manageReservations": true,
        "managePractitioners": false,
        "manageSettings": false,
        "viewAnalytics": false,
        "manageAdmins": false
    }',
    
    -- 所属店舗（空=全店舗アクセス可能）
    store_ids UUID[] DEFAULT '{}',
    
    -- 状態
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admins_tenant ON admins (tenant_id);
CREATE INDEX idx_admins_firebase ON admins (firebase_uid);
CREATE UNIQUE INDEX idx_admins_email_tenant ON admins (tenant_id, email);

-- RLS
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admins FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 15. 日次集計テーブル（分析用）
-- ============================================================
CREATE TABLE daily_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id),
    
    date DATE NOT NULL,
    
    -- 売上
    total_revenue INTEGER DEFAULT 0,
    reservation_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    canceled_count INTEGER DEFAULT 0,
    no_show_count INTEGER DEFAULT 0,
    
    -- 顧客
    new_customers INTEGER DEFAULT 0,
    returning_customers INTEGER DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,
    
    -- 平均
    average_order_value INTEGER DEFAULT 0,
    
    -- スタッフ別売上 (JSONB)
    revenue_by_practitioner JSONB DEFAULT '{}',
    
    -- メニュー別売上 (JSONB)
    revenue_by_menu JSONB DEFAULT '{}',

    -- メニュー別予約数 (JSONB)
    reservations_count_by_menu JSONB DEFAULT '{}',

    -- 施術者別ユニーク顧客数 (JSONB)
    unique_customers_by_practitioner JSONB DEFAULT '{}',

    -- 時間帯別予約数 (JSONB)
    reservations_by_hour JSONB DEFAULT '{}',
    
    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (tenant_id, store_id, date)
);

CREATE INDEX idx_daily_analytics_tenant_date ON daily_analytics (tenant_id, date);

-- RLS
ALTER TABLE daily_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON daily_analytics FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 16. 設定テーブル
-- ============================================================
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id),
    
    -- 店舗情報
    shop_name VARCHAR(100),
    shop_description TEXT,
    shop_image_url TEXT,
    
    -- 通知設定
    notification_new_reservation BOOLEAN DEFAULT true,
    notification_cancellation BOOLEAN DEFAULT true,
    notification_reminder BOOLEAN DEFAULT true,
    reminder_hours_before INTEGER DEFAULT 24,
    
    -- メッセージテンプレート
    message_templates JSONB DEFAULT '{}',
    
    -- その他設定
    attributes JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (tenant_id, store_id)
);

CREATE INDEX idx_settings_tenant ON settings (tenant_id);

-- RLS
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settings FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 17. マイグレーション履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 17. 監査ログテーブル
-- ============================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),
    
    -- 操作情報
    action VARCHAR(50) NOT NULL,                    -- CREATE, UPDATE, DELETE
    entity_type VARCHAR(50) NOT NULL,               -- reservation, customer, etc.
    entity_id UUID,
    
    -- 操作者
    actor_type VARCHAR(20) NOT NULL,                -- admin, customer, system
    actor_id UUID,
    actor_name VARCHAR(100),
    
    -- 変更内容
    old_values JSONB,
    new_values JSONB,
    
    -- メタ
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);

-- ============================================================
-- 18. サービスメッセージログテーブル
-- ============================================================
CREATE TABLE service_message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,

    message_type VARCHAR(50) NOT NULL,              -- reservation_confirmation, reminder_*, etc.
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('success', 'failed')),
    error TEXT,

    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_message_logs_tenant ON service_message_logs (tenant_id, sent_at DESC);
CREATE INDEX idx_service_message_logs_reservation ON service_message_logs (reservation_id);

-- RLS
ALTER TABLE service_message_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_message_logs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 関数: updated_atの自動更新
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 各テーブルにトリガー適用
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_tenant_google_calendar_oauth_updated_at BEFORE UPDATE ON tenant_google_calendar_oauth
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_tenant_salonboard_config_updated_at BEFORE UPDATE ON tenant_salonboard_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_practitioners_updated_at BEFORE UPDATE ON practitioners
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_menus_updated_at BEFORE UPDATE ON menus
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_menu_options_updated_at BEFORE UPDATE ON menu_options
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_kartes_updated_at BEFORE UPDATE ON kartes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_karte_templates_updated_at BEFORE UPDATE ON karte_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_admins_updated_at BEFORE UPDATE ON admins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_daily_analytics_updated_at BEFORE UPDATE ON daily_analytics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 関数: RLSセッション設定
-- ============================================================
CREATE OR REPLACE FUNCTION set_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

-- ローカルトランザクション用
CREATE OR REPLACE FUNCTION set_tenant_local(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, true);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- アプリケーション用ロール作成
-- ============================================================
-- 注意: パスワードは実際の環境に合わせて変更してください
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
    END IF;
END
$$;

-- テーブルへの権限付与
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 将来作成されるテーブルにも権限を付与
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ============================================================
-- 完了メッセージ
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'スキーマ作成が完了しました！（v2.1 - 改訂版）';
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'テーブル数: 17';
    RAISE NOTICE '新規追加:';
    RAISE NOTICE '  - tenant_google_calendar_oauth（Google Calendar OAuth連携）';
    RAISE NOTICE '  - tenant_salonboard_config（サロンボード連携）';
    RAISE NOTICE '  - kartes（カルテ・施術記録）';
    RAISE NOTICE '  - karte_templates（カルテテンプレート）';
    RAISE NOTICE 'RLS有効: 13テーブル';
    RAISE NOTICE '排他制約: reservationsテーブル（二重予約防止）';
    RAISE NOTICE '====================================================';
END
$$;
