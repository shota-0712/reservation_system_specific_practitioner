-- ============================================================
-- 開発用シードデータ
-- ============================================================

-- テナント作成
INSERT INTO tenants (id, slug, name, plan, status)
VALUES (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'demo-salon',
    'デモサロン株式会社',
    'pro',
    'active'
);

-- テナントIDを変数に設定
DO $$
DECLARE
    v_tenant_id UUID := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    v_store_id UUID;
    v_practitioner1_id UUID;
    v_practitioner2_id UUID;
    v_practitioner3_id UUID;
    v_menu1_id UUID;
    v_menu2_id UUID;
    v_menu3_id UUID;
    v_menu4_id UUID;
    v_menu5_id UUID;
    v_menu6_id UUID;
    v_customer1_id UUID;
    v_customer2_id UUID;
    v_customer3_id UUID;
BEGIN
    -- RLSをバイパスするためにテナント設定
    PERFORM set_config('app.current_tenant', v_tenant_id::text, true);
    
    -- ============================================================
    -- 店舗
    -- ============================================================
    v_store_id := uuid_generate_v4();
    INSERT INTO stores (id, tenant_id, name, store_code, address, phone, email)
    VALUES (
        v_store_id,
        v_tenant_id,
        '渋谷本店',
        'd3m0s4ln',
        '東京都渋谷区渋谷1-1-1',
        '03-1234-5678',
        'shibuya@demo-salon.com'
    );
    
    -- ============================================================
    -- 施術者
    -- ============================================================
    v_practitioner1_id := uuid_generate_v4();
    v_practitioner2_id := uuid_generate_v4();
    v_practitioner3_id := uuid_generate_v4();
    
    INSERT INTO practitioners (id, tenant_id, name, role, name_kana, title, description, nomination_fee, store_ids)
    VALUES 
        (v_practitioner1_id, v_tenant_id, '佐藤 美優', 'owner', 'サトウ ミユウ', 'オーナースタイリスト', '経験15年のベテランスタイリスト', 1100, ARRAY[v_store_id]),
        (v_practitioner2_id, v_tenant_id, '田中 健一', 'stylist', 'タナカ ケンイチ', 'スタイリスト', 'カラーリングが得意です', 550, ARRAY[v_store_id]),
        (v_practitioner3_id, v_tenant_id, '高橋 真由', 'assistant', 'タカハシ マユ', 'ジュニアスタイリスト', '丁寧な接客を心がけています', 0, ARRAY[v_store_id]);
    
    -- ============================================================
    -- メニュー
    -- ============================================================
    v_menu1_id := uuid_generate_v4();
    v_menu2_id := uuid_generate_v4();
    v_menu3_id := uuid_generate_v4();
    v_menu4_id := uuid_generate_v4();
    v_menu5_id := uuid_generate_v4();
    v_menu6_id := uuid_generate_v4();
    
    INSERT INTO menus (id, tenant_id, name, description, category, price, duration, display_order)
    VALUES 
        (v_menu1_id, v_tenant_id, 'カット', 'シャンプー・ブロー込み', 'カット', 5500, 60, 1),
        (v_menu2_id, v_tenant_id, 'カラー', 'リタッチ・フルカラー対応', 'カラー', 8800, 90, 2),
        (v_menu3_id, v_tenant_id, 'パーマ', 'デジタルパーマ・コールドパーマ', 'パーマ', 12000, 120, 3),
        (v_menu4_id, v_tenant_id, 'カット + カラー', 'セットメニュー', 'セット', 12000, 120, 4),
        (v_menu5_id, v_tenant_id, 'トリートメント', '集中ケアトリートメント', 'ケア', 3300, 30, 5),
        (v_menu6_id, v_tenant_id, 'ヘッドスパ', 'リラクゼーションヘッドスパ', 'ケア', 4400, 45, 6);
    
    -- ============================================================
    -- 顧客
    -- ============================================================
    v_customer1_id := uuid_generate_v4();
    v_customer2_id := uuid_generate_v4();
    v_customer3_id := uuid_generate_v4();
    
    INSERT INTO customers (id, tenant_id, name, name_kana, phone, email, total_visits, total_spend, rfm_segment, tags)
    VALUES 
        (v_customer1_id, v_tenant_id, '山田 花子', 'ヤマダ ハナコ', '090-1111-2222', 'yamada@example.com', 12, 156000, 'VIP', ARRAY['常連', 'カラー好き']),
        (v_customer2_id, v_tenant_id, '鈴木 一郎', 'スズキ イチロウ', '090-3333-4444', 'suzuki@example.com', 5, 45000, 'Regular', ARRAY['ビジネスマン']),
        (v_customer3_id, v_tenant_id, '伊藤 美咲', 'イトウ ミサキ', '090-5555-6666', 'ito@example.com', 2, 24000, 'New', ARRAY['新規', '紹介']);
    
    -- ============================================================
    -- 予約（過去・今日・未来）
    -- ============================================================
    
    -- 過去の予約（完了）
    INSERT INTO reservations (
        tenant_id, store_id, customer_id, practitioner_id,
        period, date, start_time, end_time,
        status, source, total_price, total_duration
    )
    VALUES (
        v_tenant_id, v_store_id, v_customer1_id, v_practitioner1_id,
        tstzrange(
            (CURRENT_DATE - INTERVAL '7 days') + TIME '10:00',
            (CURRENT_DATE - INTERVAL '7 days') + TIME '11:00'
        ),
        CURRENT_DATE - INTERVAL '7 days',
        '10:00'::TIME,
        '11:00'::TIME,
        'completed', 'line', 5500, 60
    );
    
    -- 今日の予約
    INSERT INTO reservations (
        tenant_id, store_id, customer_id, practitioner_id,
        period, date, start_time, end_time,
        status, source, total_price, total_duration
    )
    VALUES 
        (
            v_tenant_id, v_store_id, v_customer1_id, v_practitioner1_id,
            tstzrange(
                CURRENT_DATE + TIME '10:00',
                CURRENT_DATE + TIME '11:00'
            ),
            CURRENT_DATE,
            '10:00'::TIME,
            '11:00'::TIME,
            'confirmed', 'line', 5500, 60
        ),
        (
            v_tenant_id, v_store_id, v_customer2_id, v_practitioner2_id,
            tstzrange(
                CURRENT_DATE + TIME '14:00',
                CURRENT_DATE + TIME '15:30'
            ),
            CURRENT_DATE,
            '14:00'::TIME,
            '15:30'::TIME,
            'confirmed', 'phone', 8800, 90
        ),
        (
            v_tenant_id, v_store_id, v_customer3_id, v_practitioner3_id,
            tstzrange(
                CURRENT_DATE + TIME '16:00',
                CURRENT_DATE + TIME '18:00'
            ),
            CURRENT_DATE,
            '16:00'::TIME,
            '18:00'::TIME,
            'pending', 'line', 12000, 120
        );
    
    -- 明日の予約
    INSERT INTO reservations (
        tenant_id, store_id, customer_id, practitioner_id,
        period, date, start_time, end_time,
        status, source, total_price, total_duration
    )
    VALUES (
        v_tenant_id, v_store_id, v_customer1_id, v_practitioner1_id,
        tstzrange(
            (CURRENT_DATE + INTERVAL '1 day') + TIME '11:00',
            (CURRENT_DATE + INTERVAL '1 day') + TIME '11:30'
        ),
        CURRENT_DATE + INTERVAL '1 day',
        '11:00'::TIME,
        '11:30'::TIME,
        'confirmed', 'line', 3300, 30
    );
    
    -- ============================================================
    -- 設定
    -- ============================================================
    INSERT INTO settings (tenant_id, store_id, shop_name, shop_description)
    VALUES (
        v_tenant_id,
        v_store_id,
        'デモサロン渋谷本店',
        'お客様の「なりたい」を叶えるサロンです。'
    );
    
    -- ============================================================
    -- 管理者
    -- ============================================================
    INSERT INTO admins (tenant_id, firebase_uid, name, email, role)
    VALUES (
        v_tenant_id,
        'demo-firebase-uid-owner',
        '管理者 太郎',
        'admin@demo-salon.com',
        'owner'
    );
    
    RAISE NOTICE 'シードデータの作成が完了しました！';
    RAISE NOTICE 'テナントID: %', v_tenant_id;
    RAISE NOTICE '店舗ID: %', v_store_id;
    
END $$;
