/**
 * Seed Script - テスト用の初期データを作成
 * 使用方法: npx tsx scripts/seed.ts
 * 
 * 認証方法: gcloud auth application-default login を実行
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Firebase Admin初期化（Application Default Credentials を使用）
try {
    initializeApp({
        credential: applicationDefault(),
        projectId: 'keyexpress-reserve',
    });
    console.log('✓ Application Default Credentials で認証しました');
} catch (err: any) {
    console.error('❌ Firebase認証エラー:', err.message);
    console.log('\n以下を実行してください:');
    console.log('gcloud auth application-default login');
    process.exit(1);
}

const db = getFirestore();
const TENANT_ID = 'default';

async function seed() {
    console.log('\n🌱 シードデータを作成中...');

    const tenantRef = db.collection('tenants').doc(TENANT_ID);

    // ============================================
    // 1. 施術者（Practitioners）
    // ============================================
    console.log('\n👨‍💼 施術者を作成中...');
    const practitioners = [
        {
            name: '佐藤 美優',
            nameKana: 'サトウ ミユ',
            role: 'stylist',
            phone: '090-1234-5678',
            email: 'sato@salon.com',
            color: '#E63946',
            schedule: {
                workDays: [1, 2, 3, 4, 5, 6],
                workHours: { start: '09:00', end: '18:00' },
                breakTime: { start: '12:00', end: '13:00' },
            },
            isActive: true,
        },
        {
            name: '田中 健一',
            nameKana: 'タナカ ケンイチ',
            role: 'stylist',
            phone: '090-2345-6789',
            email: 'tanaka@salon.com',
            color: '#3B82F6',
            schedule: {
                workDays: [1, 2, 3, 4, 5],
                workHours: { start: '10:00', end: '19:00' },
            },
            isActive: true,
        },
        {
            name: '高橋 真由',
            nameKana: 'タカハシ マユ',
            role: 'assistant',
            phone: '090-3456-7890',
            email: 'takahashi@salon.com',
            color: '#10B981',
            schedule: {
                workDays: [2, 3, 4, 5, 6],
                workHours: { start: '09:00', end: '17:00' },
            },
            isActive: true,
        },
    ];

    const practitionerIds: string[] = [];
    for (const p of practitioners) {
        const docRef = await tenantRef.collection('practitioners').add({
            ...p,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        practitionerIds.push(docRef.id);
        console.log(`  ✓ ${p.name}`);
    }

    // ============================================
    // 2. メニュー（Menus）
    // ============================================
    console.log('\n📋 メニューを作成中...');
    const menus = [
        {
            name: 'カット',
            description: 'シャンプー・ブロー込み',
            category: 'カット',
            duration: 60,
            price: 5500,
            displayOrder: 1,
            isActive: true,
        },
        {
            name: 'カラー',
            description: 'リタッチ・フルカラー対応',
            category: 'カラー',
            duration: 90,
            price: 8800,
            displayOrder: 2,
            isActive: true,
        },
        {
            name: 'パーマ',
            description: 'デジタルパーマ・コールドパーマ',
            category: 'パーマ',
            duration: 120,
            price: 12000,
            displayOrder: 3,
            isActive: true,
        },
        {
            name: 'カット + カラー',
            description: 'お得なセットメニュー',
            category: 'セット',
            duration: 120,
            price: 12000,
            displayOrder: 4,
            isActive: true,
        },
        {
            name: 'トリートメント',
            description: '髪質改善トリートメント',
            category: 'ケア',
            duration: 30,
            price: 3300,
            displayOrder: 5,
            isActive: true,
        },
        {
            name: 'ヘッドスパ',
            description: 'リラックスコース',
            category: 'ケア',
            duration: 45,
            price: 4400,
            displayOrder: 6,
            isActive: true,
        },
    ];

    const menuIds: string[] = [];
    for (const m of menus) {
        const docRef = await tenantRef.collection('menus').add({
            ...m,
            availablePractitionerIds: practitionerIds,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        menuIds.push(docRef.id);
        console.log(`  ✓ ${m.name} (¥${m.price.toLocaleString()})`);
    }

    // ============================================
    // 3. 顧客（Customers）
    // ============================================
    console.log('\n👥 顧客を作成中...');
    const customers = [
        {
            name: '山田 花子',
            nameKana: 'ヤマダ ハナコ',
            phoneNumber: '090-1111-2222',
            email: 'yamada@example.com',
            totalVisits: 5,
            totalSpend: 45000,
            rfmSegment: 'loyal',
            tags: ['常連', 'カラーリピーター'],
        },
        {
            name: '鈴木 一郎',
            nameKana: 'スズキ イチロウ',
            phoneNumber: '090-2222-3333',
            email: 'suzuki@example.com',
            totalVisits: 2,
            totalSpend: 11000,
            rfmSegment: 'potential',
            tags: ['新規'],
        },
        {
            name: '伊藤 美咲',
            nameKana: 'イトウ ミサキ',
            phoneNumber: '090-3333-4444',
            email: 'ito@example.com',
            totalVisits: 12,
            totalSpend: 156000,
            rfmSegment: 'champion',
            tags: ['VIP', '月1来店'],
        },
    ];

    const customerIds: string[] = [];
    for (const c of customers) {
        const docRef = await tenantRef.collection('customers').add({
            ...c,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        customerIds.push(docRef.id);
        console.log(`  ✓ ${c.name}`);
    }

    // ============================================
    // 4. 予約（Reservations）
    // ============================================
    console.log('\n📅 予約を作成中...');
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const reservations = [
        {
            customerId: customerIds[0],
            customerName: customers[0].name,
            customerPhone: customers[0].phoneNumber,
            practitionerId: practitionerIds[0],
            practitionerName: practitioners[0].name,
            menuIds: [menuIds[0]],
            menuNames: [menus[0].name],
            date: formatDate(today),
            startTime: '10:00',
            endTime: '11:00',
            duration: 60,
            totalPrice: 5500,
            status: 'confirmed',
            source: 'LINE',
        },
        {
            customerId: customerIds[1],
            customerName: customers[1].name,
            customerPhone: customers[1].phoneNumber,
            practitionerId: practitionerIds[1],
            practitionerName: practitioners[1].name,
            menuIds: [menuIds[1]],
            menuNames: [menus[1].name],
            date: formatDate(today),
            startTime: '14:00',
            endTime: '15:30',
            duration: 90,
            totalPrice: 8800,
            status: 'pending',
            source: 'PHONE',
        },
        {
            customerId: customerIds[2],
            customerName: customers[2].name,
            customerPhone: customers[2].phoneNumber,
            practitionerId: practitionerIds[0],
            practitionerName: practitioners[0].name,
            menuIds: [menuIds[3]],
            menuNames: [menus[3].name],
            date: formatDate(today),
            startTime: '16:00',
            endTime: '18:00',
            duration: 120,
            totalPrice: 12000,
            status: 'confirmed',
            source: 'LINE',
        },
        {
            customerId: customerIds[0],
            customerName: customers[0].name,
            customerPhone: customers[0].phoneNumber,
            practitionerId: practitionerIds[2],
            practitionerName: practitioners[2].name,
            menuIds: [menuIds[4]],
            menuNames: [menus[4].name],
            date: formatDate(new Date(today.getTime() + 24 * 60 * 60 * 1000)),
            startTime: '11:00',
            endTime: '11:30',
            duration: 30,
            totalPrice: 3300,
            status: 'confirmed',
            source: 'LINE',
        },
    ];

    for (const r of reservations) {
        await tenantRef.collection('reservations').add({
            ...r,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`  ✓ ${r.date} ${r.startTime} - ${r.customerName} (${r.menuNames[0]})`);
    }

    // ============================================
    // 5. 設定（Settings）
    // ============================================
    console.log('\n⚙️ 設定を作成中...');
    await tenantRef.collection('settings').doc('general').set({
        salonName: 'Hair Salon ABC',
        businessHours: {
            start: '09:00',
            end: '19:00',
        },
        closedDays: [0],
        slotDuration: 30,
        maxAdvanceBookingDays: 60,
        allowSameDayBooking: true,
        sameDayBookingCutoffHours: 2,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('  ✓ 店舗設定');

    console.log('\n✅ シードデータの作成が完了しました！');
    console.log(`\nテナントID: ${TENANT_ID}`);
    console.log(`施術者: ${practitioners.length}名`);
    console.log(`メニュー: ${menus.length}件`);
    console.log(`顧客: ${customers.length}名`);
    console.log(`予約: ${reservations.length}件`);
}

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ エラー:', err);
        process.exit(1);
    });
