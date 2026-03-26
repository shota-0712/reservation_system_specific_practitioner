-- ============================================================
-- マルチテナント予約・CRMシステム PostgreSQLスキーマ
-- Version: 3.0.0  (v3+Wave-1 canonical – fresh install only)
-- Created: 2026-03-09
-- Notes:
--   * This file is used exclusively for NEW database bootstrap.
--   * Do NOT apply to existing databases; use the numbered migrations instead.
--   * Legacy columns (period, date, start_time, end_time, store_ids, etc.)
--     are intentionally absent – they are v3-clean from birth.
-- ============================================================

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- 排他制約に必要
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- テキスト検索用

-- ============================================================
-- Roles (migration_user / app_user)
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migration_user') THEN
        CREATE ROLE migration_user WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
    END IF;
END
$$;

-- app_user must NOT bypass RLS
ALTER ROLE app_user NOBYPASSRLS;

-- ============================================================
-- 1. テナント（企業）テーブル
-- ============================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 識別子
    slug VARCHAR(50) UNIQUE NOT NULL,           -- 管理画面URL用 (salon-group-a)

    -- 基本情報
    name VARCHAR(200) NOT NULL,

    -- プランと状態
    plan VARCHAR(20) NOT NULL DEFAULT 'trial'
        CHECK (plan IN ('free', 'trial', 'basic', 'pro', 'enterprise')),
    status VARCHAR(20) NOT NULL DEFAULT 'trial'
        CHECK (status IN ('active', 'trial', 'suspended', 'canceled')),

    -- オンボーディング
    onboarding_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (onboarding_status IN ('pending', 'in_progress', 'completed')),
    onboarding_completed_at TIMESTAMPTZ,
    onboarding_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- LINE設定（テナント単位、暗号化して保存）
    line_mode VARCHAR(20) NOT NULL DEFAULT 'tenant'
        CHECK (line_mode IN ('tenant', 'store', 'practitioner')),
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
CREATE INDEX idx_tenants_onboarding_status ON tenants (onboarding_status, updated_at DESC);
CREATE INDEX idx_tenants_line_mode ON tenants (line_mode);

-- ============================================================
-- 2. テナントGoogle Calendar OAuth設定
-- ============================================================
CREATE TABLE tenant_google_calendar_oauth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,

    refresh_token_encrypted TEXT NOT NULL,
    scope TEXT NOT NULL,
    email VARCHAR(255),

    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'revoked')),

    channel_ids JSONB DEFAULT '[]',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ
);

CREATE INDEX idx_tenant_google_calendar_oauth_status ON tenant_google_calendar_oauth (tenant_id, status);
ALTER TABLE tenant_google_calendar_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_google_calendar_oauth FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_google_calendar_oauth FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 3. テナントサロンボード連携設定
-- ============================================================
CREATE TABLE tenant_salonboard_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,

    username_encrypted TEXT,
    password_encrypted TEXT,
    session_cookie_encrypted TEXT,

    is_enabled BOOLEAN DEFAULT false,
    sync_direction VARCHAR(20) DEFAULT 'both'
        CHECK (sync_direction IN ('inbound', 'outbound', 'both')),

    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(20),
    last_sync_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_salonboard_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_salonboard_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_salonboard_config FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 4. 店舗テーブル
-- ============================================================
CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    store_code VARCHAR(10) UNIQUE NOT NULL
        CHECK (store_code ~ '^[a-z0-9]{8,10}$'),
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(255),
    timezone VARCHAR(50) DEFAULT 'Asia/Tokyo',

    business_hours JSONB DEFAULT '{
        "0": {"isOpen": false},
        "1": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "2": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "3": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "4": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "5": {"isOpen": true, "openTime": "10:00", "closeTime": "20:00"},
        "6": {"isOpen": true, "openTime": "10:00", "closeTime": "19:00"}
    }',

    regular_holidays INTEGER[] DEFAULT '{}',
    temporary_holidays DATE[] DEFAULT '{}',
    temporary_open_days DATE[] DEFAULT '{}',

    slot_duration INTEGER DEFAULT 30,
    advance_booking_days INTEGER DEFAULT 30,
    cancel_deadline_hours INTEGER DEFAULT 24,
    require_phone BOOLEAN DEFAULT true,
    require_email BOOLEAN DEFAULT false,

    -- LINE設定（店舗単位）
    line_liff_id VARCHAR(80),
    line_channel_id VARCHAR(80),
    line_channel_access_token_encrypted TEXT,
    line_channel_secret_encrypted TEXT,

    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    display_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stores_tenant ON stores (tenant_id);
CREATE INDEX idx_stores_line_liff_id ON stores (tenant_id, line_liff_id)
    WHERE line_liff_id IS NOT NULL;

-- RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stores FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- Tenant-safe composite unique (needed for FK references)
ALTER TABLE stores ADD CONSTRAINT stores_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 5. 施術者（スタッフ）テーブル
-- NOTE: store_ids column removed in v3; use practitioner_store_assignments
-- ============================================================
CREATE TABLE practitioners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'stylist'
        CHECK (role IN ('stylist', 'assistant', 'owner')),
    name_kana VARCHAR(100),
    title VARCHAR(50),
    color VARCHAR(7) DEFAULT '#3b82f6',
    image_url TEXT,
    description TEXT,
    experience VARCHAR(50),

    pr_title VARCHAR(200),
    specialties TEXT[] DEFAULT '{}',

    sns_instagram VARCHAR(100),
    sns_twitter VARCHAR(100),

    google_calendar_id VARCHAR(255),
    salonboard_staff_id VARCHAR(100),

    nomination_fee INTEGER DEFAULT 0,

    work_schedule JSONB DEFAULT '{}',

    -- LINE設定（施術者単位）
    line_liff_id VARCHAR(80),
    line_channel_id VARCHAR(80),
    line_channel_access_token_encrypted TEXT,
    line_channel_secret_encrypted TEXT,

    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_practitioners_tenant ON practitioners (tenant_id);
CREATE INDEX idx_practitioners_active ON practitioners (tenant_id, is_active, display_order);
CREATE INDEX idx_practitioners_line_liff_id ON practitioners (tenant_id, line_liff_id)
    WHERE line_liff_id IS NOT NULL;

-- RLS
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE practitioners FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON practitioners FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

ALTER TABLE practitioners ADD CONSTRAINT practitioners_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 6. メニューテーブル
-- NOTE: practitioner_ids column removed in v3; use menu_practitioner_assignments
-- ============================================================
CREATE TABLE menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50),

    price INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 30,

    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    attributes JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menus_tenant ON menus (tenant_id);
CREATE INDEX idx_menus_active ON menus (tenant_id, is_active, display_order);
CREATE INDEX idx_menus_category ON menus (tenant_id, category, display_order);

-- RLS
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menus FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

ALTER TABLE menus ADD CONSTRAINT menus_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 7. オプションテーブル
-- NOTE: applicable_menu_ids column removed in v3; use option_menu_assignments
-- ============================================================
CREATE TABLE menu_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    duration INTEGER DEFAULT 0,

    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_options_tenant ON menu_options (tenant_id);

-- RLS
ALTER TABLE menu_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_options FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_options FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

ALTER TABLE menu_options ADD CONSTRAINT menu_options_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 8. 顧客テーブル（CRM）
-- ============================================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    name_kana VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),

    -- LINE連携
    line_user_id VARCHAR(50),
    line_display_name VARCHAR(100),
    line_picture_url TEXT,

    -- 通知トークン（v3正本: lineNotificationToken のみ。attributes.notificationToken fallback廃止）
    line_notification_token TEXT,
    line_notification_token_expires_at TIMESTAMPTZ,

    -- 詳細プロファイル
    birthday DATE,
    gender VARCHAR(10),

    hair_type VARCHAR(50),
    scalp_condition VARCHAR(50),

    allergies TEXT[] DEFAULT '{}',
    medical_notes TEXT,
    preferences TEXT,

    questionnaire JSONB DEFAULT '{}',

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
    rfm_recency_score INTEGER,
    rfm_frequency_score INTEGER,
    rfm_monetary_score INTEGER,
    rfm_segment VARCHAR(20),

    -- カスタムフィールド
    attributes JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    notes TEXT,

    is_active BOOLEAN DEFAULT true,

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
CREATE INDEX idx_customers_line_notification_token ON customers (tenant_id, line_notification_token)
    WHERE line_notification_token IS NOT NULL;

-- Unique constraint for LINE user per tenant
CREATE UNIQUE INDEX idx_customers_tenant_line_user_unique ON customers (tenant_id, line_user_id)
    WHERE line_user_id IS NOT NULL;

-- RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

ALTER TABLE customers ADD CONSTRAINT customers_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 9. 予約テーブル（v3: canonical time model）
-- NOTE: period, date, start_time, end_time columns REMOVED.
--       starts_at / ends_at / timezone are the sole time representation.
-- ============================================================
CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    store_id UUID,
    customer_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,

    -- ★★★ v3 canonical time fields ★★★
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Tokyo',

    CONSTRAINT reservations_starts_before_ends CHECK (starts_at < ends_at),

    -- ステータス
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),

    -- 予約元
    source VARCHAR(20) DEFAULT 'line'
        CHECK (source IN ('line', 'phone', 'walk_in', 'salonboard', 'hotpepper', 'web', 'admin', 'google_calendar')),

    -- 外部連携ID
    google_calendar_id VARCHAR(255),
    google_calendar_event_id VARCHAR(255),
    salonboard_reservation_id VARCHAR(255),

    -- 料金
    subtotal INTEGER DEFAULT 0,
    option_total INTEGER DEFAULT 0,
    nomination_fee INTEGER DEFAULT 0,
    discount INTEGER DEFAULT 0,
    total_price INTEGER DEFAULT 0,

    -- 所要時間（分）
    total_duration INTEGER DEFAULT 0,

    -- スナップショット（表示用・非正規化）
    customer_name VARCHAR(100),
    customer_phone VARCHAR(20),
    practitioner_name VARCHAR(100),

    -- メモ
    notes TEXT,
    internal_note TEXT,
    attributes JSONB DEFAULT '{}',

    -- キャンセル情報
    canceled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    canceled_by VARCHAR(20),

    -- リマインダー
    reminder_sent_at TIMESTAMPTZ,

    -- タイムスタンプ
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ★★★ 排他制約：二重予約の完全防止（v3: tstzrange based） ★★★
    CONSTRAINT reservations_no_overlap_v3
        EXCLUDE USING GIST (
            tenant_id WITH =,
            practitioner_id WITH =,
            tstzrange(starts_at, ends_at, '[)') WITH &&
        ) WHERE (status NOT IN ('canceled', 'no_show'))
);

-- Indexes
CREATE INDEX idx_reservations_tenant ON reservations (tenant_id);
CREATE INDEX idx_reservations_customer ON reservations (tenant_id, customer_id);
CREATE INDEX idx_reservations_practitioner ON reservations (tenant_id, practitioner_id, starts_at);
CREATE INDEX idx_reservations_status ON reservations (tenant_id, status, starts_at);
CREATE INDEX idx_reservations_tenant_starts_at ON reservations (tenant_id, starts_at);
CREATE INDEX idx_reservations_tenant_store_starts_at ON reservations (tenant_id, store_id, starts_at);
CREATE INDEX idx_reservations_google_calendar ON reservations (tenant_id, google_calendar_event_id);
CREATE UNIQUE INDEX idx_reservations_salonboard
    ON reservations (tenant_id, salonboard_reservation_id)
    WHERE salonboard_reservation_id IS NOT NULL;

-- RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservations FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- Composite unique for tenant-safe FKs
ALTER TABLE reservations ADD CONSTRAINT reservations_tenant_id_id_unique UNIQUE (tenant_id, id);

-- Tenant-safe FK references (added after composite uniques exist)
-- (These are added after the referenced tables have their own composite uniques)

-- ============================================================
-- 10. 予約メニュー中間テーブル
-- ============================================================
CREATE TABLE reservation_menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID NOT NULL,
    menu_id UUID NOT NULL,

    menu_name VARCHAR(100) NOT NULL,
    menu_price INTEGER NOT NULL,
    menu_duration INTEGER NOT NULL,

    sort_order INTEGER DEFAULT 0,
    is_main BOOLEAN DEFAULT false,
    quantity INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reservation_menus_reservation ON reservation_menus (reservation_id);
CREATE INDEX idx_reservation_menus_tenant ON reservation_menus (tenant_id);

-- RLS
ALTER TABLE reservation_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_menus FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservation_menus FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 11. 予約オプション中間テーブル
-- ============================================================
CREATE TABLE reservation_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID NOT NULL,
    option_id UUID NOT NULL,

    option_name VARCHAR(100) NOT NULL,
    option_price INTEGER NOT NULL,
    option_duration INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reservation_options_reservation ON reservation_options (reservation_id);
CREATE INDEX idx_reservation_options_tenant ON reservation_options (tenant_id);

-- RLS
ALTER TABLE reservation_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_options FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reservation_options FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 12. カルテ（施術記録）テーブル
-- ============================================================
CREATE TABLE kartes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    customer_id UUID NOT NULL,
    reservation_id UUID,
    store_id UUID,
    practitioner_id UUID NOT NULL,

    customer_name VARCHAR(100),
    customer_picture_url TEXT,

    visit_date DATE NOT NULL,
    menu_ids UUID[] DEFAULT '{}',
    menu_names TEXT[] DEFAULT '{}',
    option_ids UUID[] DEFAULT '{}',
    duration INTEGER,
    total_amount INTEGER,

    treatment_description TEXT,
    color_formula TEXT,
    products_used TEXT[] DEFAULT '{}',

    customer_request TEXT,
    conversation_memo TEXT,
    next_visit_note TEXT,

    custom_fields JSONB DEFAULT '{}',

    photos_before TEXT[] DEFAULT '{}',
    photos_after TEXT[] DEFAULT '{}',
    photos_other JSONB DEFAULT '[]',

    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'completed')),
    tags TEXT[] DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID
);

CREATE INDEX idx_kartes_tenant ON kartes (tenant_id);
CREATE INDEX idx_kartes_customer ON kartes (tenant_id, customer_id, visit_date DESC);
CREATE INDEX idx_kartes_reservation ON kartes (reservation_id);
CREATE INDEX idx_kartes_date ON kartes (tenant_id, visit_date DESC);
CREATE INDEX idx_kartes_tags ON kartes USING GIN (tags);

-- RLS
ALTER TABLE kartes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kartes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kartes FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 13. カルテテンプレートテーブル
-- ============================================================
CREATE TABLE karte_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,

    fields JSONB NOT NULL DEFAULT '[]',

    applicable_menu_categories TEXT[] DEFAULT '{}',

    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_karte_templates_tenant ON karte_templates (tenant_id);

-- RLS
ALTER TABLE karte_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE karte_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON karte_templates FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 14. 管理者テーブル
-- NOTE: store_ids column removed in v3; use admin_store_assignments
-- ============================================================
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    firebase_uid VARCHAR(128) UNIQUE NOT NULL,

    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,

    line_user_id VARCHAR(50),

    role VARCHAR(20) NOT NULL DEFAULT 'staff'
        CHECK (role IN ('owner', 'admin', 'manager', 'staff')),

    permissions JSONB DEFAULT '{
        "manageMenus": false,
        "manageReservations": true,
        "managePractitioners": false,
        "manageSettings": false,
        "viewAnalytics": false,
        "manageAdmins": false
    }',

    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admins_tenant ON admins (tenant_id);
CREATE INDEX idx_admins_firebase ON admins (firebase_uid);
CREATE UNIQUE INDEX idx_admins_email_tenant ON admins (tenant_id, email);

-- RLS: tenant isolation with NULLIF guard + firebase_uid lookup
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON admins FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

CREATE POLICY firebase_uid_lookup ON admins FOR SELECT
    USING (firebase_uid = NULLIF(current_setting('app.current_firebase_uid', true), ''));

-- Composite unique for tenant-safe FKs
ALTER TABLE admins ADD CONSTRAINT admins_tenant_id_id_unique UNIQUE (tenant_id, id);

-- ============================================================
-- 15. 日次集計テーブル（分析用）
-- ============================================================
CREATE TABLE daily_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID,

    date DATE NOT NULL,

    total_revenue INTEGER DEFAULT 0,
    reservation_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    canceled_count INTEGER DEFAULT 0,
    no_show_count INTEGER DEFAULT 0,

    new_customers INTEGER DEFAULT 0,
    returning_customers INTEGER DEFAULT 0,
    unique_customers INTEGER DEFAULT 0,

    average_order_value INTEGER DEFAULT 0,

    revenue_by_practitioner JSONB DEFAULT '{}',
    revenue_by_menu JSONB DEFAULT '{}',
    reservations_count_by_menu JSONB DEFAULT '{}',
    unique_customers_by_practitioner JSONB DEFAULT '{}',
    reservations_by_hour JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, store_id, date)
);

CREATE INDEX idx_daily_analytics_tenant_date ON daily_analytics (tenant_id, date);
CREATE INDEX idx_daily_analytics_tenant_store_date ON daily_analytics (tenant_id, store_id, date DESC);
CREATE INDEX idx_daily_analytics_tenant_created_at ON daily_analytics (tenant_id, created_at DESC);

-- RLS
ALTER TABLE daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_analytics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON daily_analytics FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 16. 設定テーブル
-- ============================================================
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID,

    shop_name VARCHAR(100),
    shop_description TEXT,
    shop_image_url TEXT,

    notification_new_reservation BOOLEAN DEFAULT true,
    notification_cancellation BOOLEAN DEFAULT true,
    notification_reminder BOOLEAN DEFAULT true,
    reminder_hours_before INTEGER DEFAULT 24,

    message_templates JSONB DEFAULT '{}',

    attributes JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, store_id)
);

CREATE INDEX idx_settings_tenant ON settings (tenant_id);

-- RLS
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settings FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 17. マイグレーション履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    version VARCHAR(64),
    checksum TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations (version);

-- ============================================================
-- 18. 監査ログテーブル
-- ============================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id),

    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,

    actor_type VARCHAR(20) NOT NULL,
    actor_id TEXT,
    actor_name VARCHAR(100),

    old_values JSONB,
    new_values JSONB,

    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_tenant_action ON audit_logs (tenant_id, action, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (tenant_id, actor_type, actor_id, created_at DESC);

-- RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 19. サービスメッセージログテーブル
-- ============================================================
CREATE TABLE service_message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID,

    message_type VARCHAR(50) NOT NULL,
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
ALTER TABLE service_message_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service_message_logs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 20. Google Calendar 同期キューテーブル
-- ============================================================
CREATE TABLE google_calendar_sync_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reservation_id UUID,

    action VARCHAR(20) NOT NULL
        CHECK (action IN ('create', 'update', 'delete')),

    calendar_id VARCHAR(255),
    event_id VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 10,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    succeeded_at TIMESTAMPTZ,
    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_google_calendar_sync_tasks_tenant_status_next
    ON google_calendar_sync_tasks (tenant_id, status, next_run_at ASC);
CREATE INDEX idx_google_calendar_sync_tasks_reservation
    ON google_calendar_sync_tasks (reservation_id, created_at DESC);
CREATE UNIQUE INDEX idx_google_calendar_sync_tasks_dedupe
    ON google_calendar_sync_tasks (tenant_id, reservation_id, action)
    WHERE status IN ('pending', 'running');

-- RLS
ALTER TABLE google_calendar_sync_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_sync_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON google_calendar_sync_tasks FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 21. 予約リンクトークンテーブル
-- ============================================================
CREATE TABLE booking_link_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID,
    practitioner_id UUID NOT NULL,
    token VARCHAR(128) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'revoked')),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_booking_link_tokens_token ON booking_link_tokens (token);
CREATE INDEX idx_booking_link_tokens_tenant_status
    ON booking_link_tokens (tenant_id, status, created_at DESC);
CREATE INDEX idx_booking_link_tokens_practitioner
    ON booking_link_tokens (tenant_id, practitioner_id, created_at DESC);

-- RLS
ALTER TABLE booking_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_link_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON booking_link_tokens FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 22. Assignment tables (many-to-many normalization)
-- practitioner_store_assignments
-- menu_practitioner_assignments
-- option_menu_assignments
-- admin_store_assignments
-- ============================================================

-- 22a. 施術者-店舗 割当
CREATE TABLE practitioner_store_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    practitioner_id UUID NOT NULL,
    store_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, practitioner_id, store_id),
    CONSTRAINT practitioner_store_assignments_practitioner_fk
        FOREIGN KEY (tenant_id, practitioner_id)
        REFERENCES practitioners(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT practitioner_store_assignments_store_fk
        FOREIGN KEY (tenant_id, store_id)
        REFERENCES stores(tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_practitioner_store_assignments_store
    ON practitioner_store_assignments (tenant_id, store_id, practitioner_id);

ALTER TABLE practitioner_store_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE practitioner_store_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON practitioner_store_assignments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 22b. メニュー-施術者 割当
CREATE TABLE menu_practitioner_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    menu_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, menu_id, practitioner_id),
    CONSTRAINT menu_practitioner_assignments_menu_fk
        FOREIGN KEY (tenant_id, menu_id)
        REFERENCES menus(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT menu_practitioner_assignments_practitioner_fk
        FOREIGN KEY (tenant_id, practitioner_id)
        REFERENCES practitioners(tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_menu_practitioner_assignments_practitioner
    ON menu_practitioner_assignments (tenant_id, practitioner_id, menu_id);

ALTER TABLE menu_practitioner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_practitioner_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_practitioner_assignments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 22c. オプション-メニュー 割当
CREATE TABLE option_menu_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    option_id UUID NOT NULL,
    menu_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, option_id, menu_id),
    CONSTRAINT option_menu_assignments_option_fk
        FOREIGN KEY (tenant_id, option_id)
        REFERENCES menu_options(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT option_menu_assignments_menu_fk
        FOREIGN KEY (tenant_id, menu_id)
        REFERENCES menus(tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_option_menu_assignments_menu
    ON option_menu_assignments (tenant_id, menu_id, option_id);

ALTER TABLE option_menu_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE option_menu_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON option_menu_assignments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 22d. 管理者-店舗 割当
CREATE TABLE admin_store_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL,
    store_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, admin_id, store_id),
    CONSTRAINT admin_store_assignments_admin_fk
        FOREIGN KEY (tenant_id, admin_id)
        REFERENCES admins(tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT admin_store_assignments_store_fk
        FOREIGN KEY (tenant_id, store_id)
        REFERENCES stores(tenant_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_admin_store_assignments_store
    ON admin_store_assignments (tenant_id, store_id, admin_id);

ALTER TABLE admin_store_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_store_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_store_assignments FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 23. Export jobs テーブル（GCS拡張込み）
-- ============================================================
CREATE TABLE export_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID,
    export_type VARCHAR(50) NOT NULL
        CHECK (export_type IN (
            'operations_reservations',
            'operations_customers',
            'analytics_store_daily_kpi',
            'analytics_menu_performance'
        )),
    format VARCHAR(10) NOT NULL DEFAULT 'csv'
        CHECK (format IN ('csv')),
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    requested_by TEXT,
    row_count INTEGER,
    csv_content TEXT,
    error_message TEXT,
    -- GCS storage
    storage_type VARCHAR(20) NOT NULL DEFAULT 'inline'
        CHECK (storage_type IN ('inline', 'gcs')),
    gcs_bucket TEXT,
    gcs_object_path TEXT,
    download_url_expires_at TIMESTAMPTZ,

    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_export_jobs_tenant_status_requested
    ON export_jobs (tenant_id, status, requested_at DESC);
CREATE INDEX idx_export_jobs_tenant_store_requested
    ON export_jobs (tenant_id, store_id, requested_at DESC);
CREATE INDEX idx_export_jobs_storage_type
    ON export_jobs (tenant_id, storage_type, requested_at DESC);

-- RLS
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON export_jobs FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- ============================================================
-- 24. tenant_rfm_settings テーブル（CRM-BE-001）
-- ============================================================
CREATE TABLE tenant_rfm_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    recency_score5  INTEGER NOT NULL DEFAULT 30,
    recency_score4  INTEGER NOT NULL DEFAULT 60,
    recency_score3  INTEGER NOT NULL DEFAULT 90,
    recency_score2  INTEGER NOT NULL DEFAULT 180,
    frequency_score5 INTEGER NOT NULL DEFAULT 12,
    frequency_score4 INTEGER NOT NULL DEFAULT 8,
    frequency_score3 INTEGER NOT NULL DEFAULT 4,
    frequency_score2 INTEGER NOT NULL DEFAULT 2,
    monetary_score5  INTEGER NOT NULL DEFAULT 100000,
    monetary_score4  INTEGER NOT NULL DEFAULT 50000,
    monetary_score3  INTEGER NOT NULL DEFAULT 20000,
    monetary_score2  INTEGER NOT NULL DEFAULT 10000,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by      TEXT
);

ALTER TABLE tenant_rfm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_rfm_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_rfm_settings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

COMMENT ON TABLE tenant_rfm_settings IS 'Per-tenant RFM scoring thresholds. Missing row = use service defaults.';

-- ============================================================
-- 25. tenant_notification_settings テーブル（CRM-BE-006）
-- ============================================================
CREATE TABLE tenant_notification_settings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    email_new_reservation   BOOLEAN NOT NULL DEFAULT TRUE,
    email_cancellation      BOOLEAN NOT NULL DEFAULT TRUE,
    email_daily_report      BOOLEAN NOT NULL DEFAULT TRUE,
    line_reminder           BOOLEAN NOT NULL DEFAULT TRUE,
    line_confirmation       BOOLEAN NOT NULL DEFAULT TRUE,
    line_review             BOOLEAN NOT NULL DEFAULT TRUE,
    push_new_reservation    BOOLEAN NOT NULL DEFAULT TRUE,
    push_cancellation       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by              TEXT
);

ALTER TABLE tenant_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_notification_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_notification_settings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

COMMENT ON TABLE tenant_notification_settings IS 'Per-tenant notification preferences for admin settings UI.';

-- ============================================================
-- Tenant-safe composite FK references (cross-table)
-- ============================================================

-- reservations → stores (tenant-safe)
ALTER TABLE reservations
    ADD CONSTRAINT reservations_tenant_store_fk_v3
    FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE reservations VALIDATE CONSTRAINT reservations_tenant_store_fk_v3;

-- reservations → customers (tenant-safe)
ALTER TABLE reservations
    ADD CONSTRAINT reservations_tenant_customer_fk_v3
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, id)
    ON DELETE RESTRICT;

-- reservations → practitioners (tenant-safe)
ALTER TABLE reservations
    ADD CONSTRAINT reservations_tenant_practitioner_fk_v3
    FOREIGN KEY (tenant_id, practitioner_id)
    REFERENCES practitioners(tenant_id, id)
    ON DELETE RESTRICT;

-- reservation_menus → reservations (tenant-safe)
ALTER TABLE reservation_menus
    ADD CONSTRAINT reservation_menus_tenant_reservation_fk_v3
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservations(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE reservation_menus
    ADD CONSTRAINT reservation_menus_tenant_menu_fk_v3
    FOREIGN KEY (tenant_id, menu_id)
    REFERENCES menus(tenant_id, id)
    ON DELETE RESTRICT;

-- reservation_options → reservations (tenant-safe)
ALTER TABLE reservation_options
    ADD CONSTRAINT reservation_options_tenant_reservation_fk_v3
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservations(tenant_id, id)
    ON DELETE CASCADE;

ALTER TABLE reservation_options
    ADD CONSTRAINT reservation_options_tenant_option_fk_v3
    FOREIGN KEY (tenant_id, option_id)
    REFERENCES menu_options(tenant_id, id)
    ON DELETE RESTRICT;

-- kartes (tenant-safe)
ALTER TABLE kartes
    ADD CONSTRAINT kartes_tenant_customer_fk_v3
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, id)
    ON DELETE RESTRICT;

ALTER TABLE kartes
    ADD CONSTRAINT kartes_tenant_reservation_fk_v3
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservations(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE kartes
    ADD CONSTRAINT kartes_tenant_store_fk_v3
    FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE kartes
    ADD CONSTRAINT kartes_tenant_practitioner_fk_v3
    FOREIGN KEY (tenant_id, practitioner_id)
    REFERENCES practitioners(tenant_id, id)
    ON DELETE RESTRICT;

-- booking_link_tokens (tenant-safe)
ALTER TABLE booking_link_tokens
    ADD CONSTRAINT booking_link_tokens_tenant_store_fk_v3
    FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE booking_link_tokens
    ADD CONSTRAINT booking_link_tokens_tenant_practitioner_fk_v3
    FOREIGN KEY (tenant_id, practitioner_id)
    REFERENCES practitioners(tenant_id, id)
    ON DELETE CASCADE;

-- google_calendar_sync_tasks → reservations (tenant-safe)
ALTER TABLE google_calendar_sync_tasks
    ADD CONSTRAINT google_calendar_sync_tasks_tenant_reservation_fk_v3
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservations(tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

-- service_message_logs → reservations (tenant-safe)
ALTER TABLE service_message_logs
    ADD CONSTRAINT service_message_logs_tenant_reservation_fk_v3
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES reservations(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

-- export_jobs → stores (tenant-safe)
ALTER TABLE export_jobs
    ADD CONSTRAINT export_jobs_tenant_store_fk_v3
    FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores(tenant_id, id)
    ON DELETE SET NULL
    NOT VALID;

-- ============================================================
-- Trigger: updated_atの自動更新
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_tenant_google_calendar_oauth_updated_at
    BEFORE UPDATE ON tenant_google_calendar_oauth FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_tenant_salonboard_config_updated_at
    BEFORE UPDATE ON tenant_salonboard_config FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_stores_updated_at
    BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_practitioners_updated_at
    BEFORE UPDATE ON practitioners FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_menus_updated_at
    BEFORE UPDATE ON menus FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_menu_options_updated_at
    BEFORE UPDATE ON menu_options FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_reservations_updated_at
    BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_kartes_updated_at
    BEFORE UPDATE ON kartes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_karte_templates_updated_at
    BEFORE UPDATE ON karte_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_admins_updated_at
    BEFORE UPDATE ON admins FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_daily_analytics_updated_at
    BEFORE UPDATE ON daily_analytics FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_export_jobs_updated_at
    BEFORE UPDATE ON export_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_google_calendar_sync_tasks_updated_at
    BEFORE UPDATE ON google_calendar_sync_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Trigger: 予約ステータス遷移強制
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_reservation_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'pending'
       AND NEW.status IN ('confirmed', 'canceled', 'no_show') THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'confirmed'
       AND NEW.status IN ('completed', 'canceled', 'no_show') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format('Invalid reservation status transition: %s -> %s', OLD.status, NEW.status);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_reservation_status_transition_trigger
    BEFORE UPDATE OF status ON reservations
    FOR EACH ROW EXECUTE FUNCTION enforce_reservation_status_transition();

-- ============================================================
-- Function: RLSセッション設定
-- ============================================================
CREATE OR REPLACE FUNCTION set_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_tenant_local(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, true);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Function: resolve_active_store_context (MT Wave-1)
-- SECURITY DEFINER: resolves store_code -> (tenant_id, store_id)
-- without requiring caller to have tenant context.
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_active_store_context(p_store_code text)
RETURNS TABLE (
    tenant_id UUID,
    store_id  UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.tenant_id,
        s.id AS store_id
    FROM stores s
    WHERE s.store_code = p_store_code
      AND s.status     = 'active'
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_active_store_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_active_store_context(text) TO app_user;

-- ============================================================
-- Function: resolve_booking_link_token
-- SECURITY DEFINER: resolves booking link token under strict RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_booking_link_token(p_token TEXT)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    store_id UUID,
    practitioner_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        blt.id,
        blt.tenant_id,
        blt.store_id,
        blt.practitioner_id
    FROM booking_link_tokens blt
    WHERE blt.token = p_token
      AND blt.status = 'active'
      AND (blt.expires_at IS NULL OR blt.expires_at > NOW())
    ORDER BY blt.created_at DESC
    LIMIT 1
$$;

REVOKE ALL ON FUNCTION resolve_booking_link_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_booking_link_token(TEXT) TO app_user;

-- ============================================================
-- Permissions
-- ============================================================
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

GRANT USAGE ON SCHEMA public TO migration_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO migration_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO migration_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO migration_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO migration_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO migration_user;

-- ============================================================
-- 完了
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'v3.0.0 schema created (v3+Wave-1 canonical)';
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'Tables: 28 total (26 tenant-scoped RLS tables; no legacy date columns, no array FK columns)';
    RAISE NOTICE 'FORCE RLS: all tenant-scoped tables';
    RAISE NOTICE 'Assignment tables: practitioner_store, menu_practitioner,';
    RAISE NOTICE '                   option_menu, admin_store';
    RAISE NOTICE 'Functions: resolve_active_store_context,';
    RAISE NOTICE '           resolve_booking_link_token';
    RAISE NOTICE '====================================================';
END
$$;
