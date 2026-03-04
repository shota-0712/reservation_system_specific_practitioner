#!/usr/bin/env node
/**
 * seed-test-data.mjs
 * 管理者APIを使った包括的なテストデータ投入スクリプト
 *
 * 使い方:
 *   node scripts/seed-test-data.mjs \
 *     --email=admin@example.com \
 *     --password=yourpassword \
 *     [--api=https://reserve-api-czjwiprc2q-an.a.run.app]
 */

import { parseArgs } from 'node:util';

// ── 設定 ─────────────────────────────────────────────────────────────────────

const FIREBASE_API_KEY = 'AIzaSyDlgWGNiYP50yBRlFaWUdQg4NFSsHGx_Ro';
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const PLATFORM_API_PATH = '/api/platform/v1';
const ADMIN_API_PATH = '/api/v1/admin';

// ── 引数パース ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
    options: {
        email:             { type: 'string' },
        password:          { type: 'string' },
        api:               { type: 'string', default: 'https://reserve-api-czjwiprc2q-an.a.run.app' },
        local:             { type: 'boolean', default: false },
        'reservations-only': { type: 'boolean', default: false },
    },
    allowPositionals: true,
});

if (args.local) {
    args.api = 'http://localhost:3001';
}

if (!args.email || !args.password) {
    console.error('Usage: node seed-test-data.mjs --email=<email> --password=<password> [--api=<url>] [--local]');
    process.exit(1);
}

const API_BASE = args.api.replace(/\/$/, '');
console.log(`\n🌱 シードデータ投入開始`);
console.log(`   API: ${API_BASE}`);
console.log(`   Email: ${args.email}\n`);

// ── ユーティリティ ────────────────────────────────────────────────────────────

let idToken = '';
let refreshToken = '';
let storeId = '';
let tenantKey = '';

const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

async function request(path, { method = 'GET', body, auth = true, baseOverride } = {}) {
    const base = baseOverride ?? API_BASE;
    const url = `${base}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && idToken) headers['Authorization'] = `Bearer ${idToken}`;

    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.json();
}

function adminPost(path, body) {
    return request(`${ADMIN_API_PATH}${path}`, { method: 'POST', body });
}
function adminGet(path) {
    return request(`${ADMIN_API_PATH}${path}`);
}

function today(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function step(label, fn) {
    process.stdout.write(`  ⏳ ${label}...`);
    try {
        const result = await fn();
        console.log(` ✅`);
        return result;
    } catch (err) {
        console.log(` ❌\n     ${err.message}`);
        throw err;
    }
}

// ── ステップ1: Firebase 認証 ──────────────────────────────────────────────────

async function signIn() {
    const res = await fetch(FIREBASE_SIGN_IN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: args.email, password: args.password, returnSecureToken: true }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Firebase Auth failed: ${err?.error?.message ?? res.status}`);
    }
    const data = await res.json();
    idToken = data.idToken;
    refreshToken = data.refreshToken;
    return data;
}

// ── トークンリフレッシュ（claims/sync後に新クレームを反映させる） ─────────────────
async function refreshIdToken() {
    const res = await fetch(FIREBASE_REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json();
    idToken = data.id_token;
    refreshToken = data.refresh_token;
}

// ── ステップ2: Custom Claims 同期 ──────────────────────────────────────────────

async function syncClaims() {
    const res = await request(`${PLATFORM_API_PATH}/admin/claims/sync`, { method: 'POST' });
    if (!res.success) throw new Error(res.error?.message ?? 'claims/sync failed');
    return res.data;
}

// ── ステップ3: 管理者コンテキスト取得 ────────────────────────────────────────────

async function fetchContext() {
    const res = await request(`${PLATFORM_API_PATH}/admin/context`);
    if (!res.success) throw new Error(res.error?.message ?? 'context fetch failed');
    const ctx = res.data;
    storeId = ctx.storeIds?.[0] ?? '';
    tenantKey = ctx.tenantKey ?? '';
    return ctx;
}

// ── ステップ4: 施術者作成 ─────────────────────────────────────────────────────

const PRACTITIONERS = [
    {
        name: '田中 美咲',
        nameKana: 'たなか みさき',
        role: 'stylist',
        title: 'トップスタイリスト',
        email: 'misaki.tanaka@example.com',
        phone: '09012345678',
        description: '10年のキャリアを持つトップスタイリスト。カットとカラーが得意です。',
        experience: '10年',
        specialties: ['カット', 'カラー', 'パーマ'],
        color: '#f59e0b',
        nominationFee: 1100,
        schedule: {
            workDays: [1, 2, 3, 4, 5],
            workHours: { start: '09:00', end: '19:00' },
            breakTime:  { start: '12:00', end: '13:00' },
        },
        isActive: true,
        displayOrder: 1,
    },
    {
        name: '佐藤 健太',
        nameKana: 'さとう けんた',
        role: 'stylist',
        title: 'スタイリスト',
        email: 'kenta.sato@example.com',
        phone: '09087654321',
        description: 'メンズカットとヘッドスパが得意なスタイリスト。',
        experience: '5年',
        specialties: ['メンズカット', 'ヘッドスパ', 'トリートメント'],
        color: '#3b82f6',
        nominationFee: 550,
        schedule: {
            workDays: [0, 1, 3, 4, 6],
            workHours: { start: '10:00', end: '20:00' },
            breakTime:  { start: '13:00', end: '14:00' },
        },
        isActive: true,
        displayOrder: 2,
    },
    {
        name: '山本 花',
        nameKana: 'やまもと はな',
        role: 'assistant',
        title: 'アシスタント',
        email: 'hana.yamamoto@example.com',
        description: 'シャンプー、トリートメント担当のアシスタント。',
        experience: '2年',
        color: '#ec4899',
        schedule: {
            workDays: [1, 2, 3, 4, 5, 6],
            workHours: { start: '09:00', end: '18:00' },
        },
        isActive: true,
        displayOrder: 3,
    },
];

async function createPractitioners() {
    const created = [];
    for (const p of PRACTITIONERS) {
        const body = { ...p };
        if (storeId) body.storeIds = [storeId];
        const res = await adminPost('/practitioners', body);
        if (!res.success) throw new Error(`practitioner create failed: ${JSON.stringify(res.error)}`);
        created.push(res.data);
        await sleep(200);
    }
    return created;
}

// ── ステップ5: メニュー作成 ───────────────────────────────────────────────────

function buildMenus(practitioners) {
    const pIds = practitioners.map((p) => p.id);
    return [
        {
            name: 'カット',
            category: 'カット',
            description: 'シャンプー・ブロー込み。お客様の骨格や髪質に合ったスタイルをご提案。',
            duration: 60,
            price: 6600,
            availablePractitionerIds: pIds,
            isActive: true,
            displayOrder: 1,
        },
        {
            name: 'カット + カラー',
            category: 'カラー',
            description: 'カット + フルカラー。グレイカバー・おしゃれカラーどちらも対応。',
            duration: 150,
            price: 16500,
            availablePractitionerIds: pIds.slice(0, 2),
            isActive: true,
            displayOrder: 2,
        },
        {
            name: 'カット + パーマ',
            category: 'パーマ',
            description: 'カット + デジタルパーマ or コールドパーマ。ふんわりカールを実現。',
            duration: 180,
            price: 22000,
            availablePractitionerIds: pIds.slice(0, 2),
            isActive: true,
            displayOrder: 3,
        },
        {
            name: 'トリートメント（単品）',
            category: 'トリートメント',
            description: '集中ケア トリートメント。ダメージ毛に潤いを。',
            duration: 60,
            price: 5500,
            availablePractitionerIds: pIds,
            isActive: true,
            displayOrder: 4,
        },
        {
            name: 'ヘッドスパ',
            category: 'スパ・ケア',
            description: '頭皮マッサージで血行促進。疲れを癒す至福の60分。',
            duration: 60,
            price: 7700,
            availablePractitionerIds: [pIds[1]].filter(Boolean),
            isActive: true,
            displayOrder: 5,
        },
        {
            name: 'カラー（リタッチ）',
            category: 'カラー',
            description: 'リタッチ（根元2cm以内）。素早くキレイな仕上がり。',
            duration: 90,
            price: 8800,
            availablePractitionerIds: pIds.slice(0, 2),
            isActive: true,
            displayOrder: 6,
        },
        {
            name: 'メンズカット',
            category: 'カット',
            description: 'メンズ専用カット。刈り上げ・フェード対応。',
            duration: 45,
            price: 4400,
            availablePractitionerIds: pIds.slice(0, 2),
            isActive: true,
            displayOrder: 7,
        },
        {
            name: 'キッズカット（〜12歳）',
            category: 'カット',
            description: 'お子様向けカット。優しいスタイリストが担当。',
            duration: 30,
            price: 2200,
            availablePractitionerIds: pIds,
            isActive: true,
            displayOrder: 8,
        },
    ];
}

async function createMenus(practitioners) {
    const created = [];
    for (const m of buildMenus(practitioners)) {
        const res = await adminPost('/menus', m);
        if (!res.success) throw new Error(`menu create failed: ${JSON.stringify(res.error)}`);
        created.push(res.data);
        await sleep(200);
    }
    return created;
}

// ── ステップ6: オプション作成 ─────────────────────────────────────────────────

function buildOptions(menus) {
    const cutIds = menus.filter((m) => m.category === 'カット').map((m) => m.id);
    const allIds = menus.map((m) => m.id);
    return [
        {
            name: 'プレミアムトリートメント',
            description: '保湿・補修効果の高いプレミアムトリートメント。',
            duration: 20,
            price: 3300,
            applicableMenuIds: allIds,
            isActive: true,
            displayOrder: 1,
        },
        {
            name: '炭酸シャンプー',
            description: '炭酸水でスッキリ洗浄。頭皮環境を整えます。',
            duration: 10,
            price: 1100,
            applicableMenuIds: allIds,
            isActive: true,
            displayOrder: 2,
        },
        {
            name: 'まゆげカット',
            description: 'カットのついでに眉毛を整えます。',
            duration: 10,
            price: 550,
            applicableMenuIds: cutIds,
            isActive: true,
            displayOrder: 3,
        },
        {
            name: 'ヘアオイル（ホームケア）',
            description: 'ホームケア用ヘアオイルをご購入いただけます（商品代金）。',
            duration: 0,
            price: 2200,
            applicableMenuIds: allIds,
            isActive: true,
            displayOrder: 4,
        },
    ];
}

async function createOptions(menus) {
    const created = [];
    for (const o of buildOptions(menus)) {
        const res = await adminPost('/options', o);
        if (!res.success) throw new Error(`option create failed: ${JSON.stringify(res.error)}`);
        created.push(res.data);
        await sleep(200);
    }
    return created;
}

// ── ステップ7: 予約作成 ───────────────────────────────────────────────────────

const CUSTOMERS = [
    { name: '鈴木 一郎', phone: '09011111111', email: 'ichiro.suzuki@example.com' },
    { name: '高橋 花子', phone: '09022222222', email: 'hanako.takahashi@example.com' },
    { name: '伊藤 太郎', phone: '09033333333', email: 'taro.ito@example.com' },
    { name: '渡辺 明美', phone: '09044444444', email: 'akemi.watanabe@example.com' },
    { name: '中村 次郎', phone: '09055555555', email: 'jiro.nakamura@example.com' },
    { name: '小林 さくら', phone: '09066666666', email: 'sakura.kobayashi@example.com' },
    { name: '加藤 誠',   phone: '09077777777', email: 'makoto.kato@example.com' },
    { name: '吉田 まい', phone: '09088888888', email: 'mai.yoshida@example.com' },
];

function buildReservations(practitioners, menus, options) {
    const p0 = practitioners[0];
    const p1 = practitioners[1];
    const p2 = practitioners[2];
    const menuCut = menus.find((m) => m.name === 'カット');
    const menuCC  = menus.find((m) => m.name === 'カット + カラー');
    const menuCP  = menus.find((m) => m.name === 'カット + パーマ');
    const menuTr  = menus.find((m) => m.name === 'トリートメント（単品）');
    const menuHS  = menus.find((m) => m.name === 'ヘッドスパ');
    const menuRC  = menus.find((m) => m.name === 'カラー（リタッチ）');
    const menuMC  = menus.find((m) => m.name === 'メンズカット');
    const menuKC  = menus.find((m) => m.name === 'キッズカット（〜12歳）');
    const optPT   = options.find((o) => o.name === 'プレミアムトリートメント');
    const optCS   = options.find((o) => o.name === '炭酸シャンプー');
    const optEB   = options.find((o) => o.name === 'まゆげカット');

    const reservations = [];

    // ────────────────────────
    // 過去の完了済み予約（-30 〜 -3日）
    // ────────────────────────
    const pastData = [
        { days: -28, time: '10:00', pr: p0, menus: [menuCC], opts: [optPT], cust: CUSTOMERS[0], status: 'completed', source: 'web' },
        { days: -25, time: '14:00', pr: p1, menus: [menuMC], opts: [],      cust: CUSTOMERS[4], status: 'completed', source: 'phone' },
        { days: -22, time: '11:00', pr: p0, menus: [menuCut], opts: [optEB],cust: CUSTOMERS[1], status: 'completed', source: 'web' },
        { days: -20, time: '15:00', pr: p1, menus: [menuHS],  opts: [],     cust: CUSTOMERS[6], status: 'completed', source: 'admin' },
        { days: -18, time: '09:00', pr: p0, menus: [menuCP],  opts: [optCS],cust: CUSTOMERS[2], status: 'completed', source: 'web' },
        { days: -15, time: '13:00', pr: p0, menus: [menuRC],  opts: [],     cust: CUSTOMERS[3], status: 'completed', source: 'web' },
        { days: -12, time: '16:00', pr: p1, menus: [menuCut], opts: [optEB],cust: CUSTOMERS[5], status: 'completed', source: 'phone' },
        { days: -10, time: '10:00', pr: p0, menus: [menuCC],  opts: [optPT],cust: CUSTOMERS[7], status: 'completed', source: 'web' },
        { days:  -8, time: '11:00', pr: p1, menus: [menuMC],  opts: [],     cust: CUSTOMERS[4], status: 'completed', source: 'walk_in' },
        { days:  -7, time: '14:00', pr: p0, menus: [menuTr],  opts: [],     cust: CUSTOMERS[0], status: 'completed', source: 'web' },
        { days:  -5, time: '10:00', pr: p0, menus: [menuCut], opts: [],     cust: CUSTOMERS[1], status: 'cancelled', source: 'web' },
        { days:  -4, time: '15:00', pr: p1, menus: [menuKC],  opts: [],     cust: CUSTOMERS[2], status: 'completed', source: 'web' },
        { days:  -3, time: '09:00', pr: p0, menus: [menuCC],  opts: [optCS],cust: CUSTOMERS[6], status: 'completed', source: 'web' },
    ];

    for (const d of pastData) {
        if (!d.menus.every(Boolean) || !d.pr) continue;
        reservations.push({
            customerName:  d.cust.name,
            customerPhone: d.cust.phone,
            customerEmail: d.cust.email,
            practitionerId: d.pr.id,
            menuIds: d.menus.map((m) => m.id),
            optionIds: d.opts.map((o) => o.id),
            date: today(d.days),
            startTime: d.time,
            status: d.status,
            source: d.source,
            storeId: storeId || undefined,
        });
    }

    // ────────────────────────
    // 本日の予約
    // ────────────────────────
    const todayData = [
        { time: '09:00', pr: p0, menus: [menuCut], opts: [optEB],  cust: CUSTOMERS[3], status: 'confirmed' },
        { time: '10:30', pr: p1, menus: [menuMC],  opts: [],       cust: CUSTOMERS[4], status: 'confirmed' },
        { time: '12:00', pr: p0, menus: [menuCC],  opts: [optPT],  cust: CUSTOMERS[5], status: 'confirmed' },
        { time: '14:00', pr: p0, menus: [menuRC],  opts: [],       cust: CUSTOMERS[0], status: 'confirmed' },
        { time: '14:30', pr: p1, menus: [menuHS],  opts: [],       cust: CUSTOMERS[6], status: 'confirmed' },
        { time: '16:00', pr: p0, menus: [menuTr],  opts: [optCS],  cust: CUSTOMERS[7], status: 'pending'   },
    ];

    for (const d of todayData) {
        if (!d.menus.every(Boolean) || !d.pr) continue;
        reservations.push({
            customerName:  d.cust.name,
            customerPhone: d.cust.phone,
            customerEmail: d.cust.email,
            practitionerId: d.pr.id,
            menuIds: d.menus.map((m) => m.id),
            optionIds: d.opts.map((o) => o.id),
            date: today(0),
            startTime: d.time,
            status: d.status,
            source: 'web',
            storeId: storeId || undefined,
        });
    }

    // ────────────────────────
    // 近未来の予約（+1 〜 +14日）
    // ────────────────────────
    const futureData = [
        { days: 1, time: '10:00', pr: p0, menus: [menuCut], opts: [],     cust: CUSTOMERS[1], status: 'confirmed' },
        { days: 1, time: '13:00', pr: p1, menus: [menuMC],  opts: [optEB],cust: CUSTOMERS[4], status: 'confirmed' },
        { days: 2, time: '11:00', pr: p0, menus: [menuCC],  opts: [optPT],cust: CUSTOMERS[2], status: 'pending'   },
        { days: 3, time: '15:00', pr: p0, menus: [menuCP],  opts: [optCS],cust: CUSTOMERS[3], status: 'confirmed' },
        { days: 5, time: '09:00', pr: p1, menus: [menuHS],  opts: [],     cust: CUSTOMERS[5], status: 'pending'   },
        { days: 7, time: '14:00', pr: p0, menus: [menuRC],  opts: [],     cust: CUSTOMERS[0], status: 'confirmed' },
        { days: 7, time: '16:00', pr: p1, menus: [menuKC],  opts: [],     cust: CUSTOMERS[6], status: 'confirmed' },
        { days:10, time: '10:00', pr: p0, menus: [menuCC],  opts: [optPT],cust: CUSTOMERS[7], status: 'pending'   },
        { days:14, time: '11:00', pr: p0, menus: [menuTr],  opts: [],     cust: CUSTOMERS[1], status: 'confirmed' },
    ];

    for (const d of futureData) {
        if (!d.menus.every(Boolean) || !d.pr) continue;
        reservations.push({
            customerName:  d.cust.name,
            customerPhone: d.cust.phone,
            customerEmail: d.cust.email,
            practitionerId: d.pr.id,
            menuIds: d.menus.map((m) => m.id),
            optionIds: d.opts.map((o) => o.id),
            date: today(d.days),
            startTime: d.time,
            status: d.status,
            source: 'web',
            storeId: storeId || undefined,
        });
    }

    return reservations;
}

async function adminPatch(path, body) {
    return request(`${ADMIN_API_PATH}${path}`, { method: 'PATCH', body });
}

async function createReservations(practitioners, menus, options) {
    const all = buildReservations(practitioners, menus, options);
    const created = [];
    let skipped = 0;
    for (const r of all) {
        // POST only accepts 'pending' | 'confirmed'; map everything else to 'confirmed'
        const desiredStatus = r.status === 'cancelled' ? 'canceled' : r.status;
        const postBody = { ...r };
        if (desiredStatus === 'completed' || desiredStatus === 'canceled') {
            postBody.status = 'confirmed';
        }
        try {
            const res = await adminPost('/reservations', postBody);
            if (!res.success) {
                console.warn(`\n     ⚠️  予約スキップ: ${r.customerName} ${r.date} ${r.startTime} — ${res.error?.message}`);
                skipped++;
                continue;
            }
            const reservation = res.data;
            // Update to the desired terminal status if different
            if (desiredStatus !== postBody.status) {
                try {
                    await adminPatch(`/reservations/${reservation.id}/status`, { status: desiredStatus });
                    reservation.status = desiredStatus;
                } catch (patchErr) {
                    console.warn(`\n     ⚠️  ステータス更新スキップ (${reservation.id} → ${desiredStatus}): ${patchErr.message}`);
                }
            }
            created.push(reservation);
        } catch (err) {
            console.warn(`\n     ⚠️  予約スキップ: ${r.customerName} ${r.date} ${r.startTime} — ${err.message}`);
            skipped++;
        }
        await sleep(150);
    }
    if (skipped > 0) console.log(`     (${skipped}件スキップ, ${created.length}件作成)`);
    return created;
}

// ── 既存データ取得（--reservations-only 用） ─────────────────────────────────

async function fetchExistingPractitioners() {
    const res = await adminGet('/practitioners?limit=50');
    if (!res.success) throw new Error('Failed to fetch practitioners');
    return res.data?.items ?? res.data ?? [];
}

async function fetchExistingMenus() {
    const res = await adminGet('/menus?limit=50');
    if (!res.success) throw new Error('Failed to fetch menus');
    return res.data?.items ?? res.data ?? [];
}

async function fetchExistingOptions() {
    const res = await adminGet('/options?limit=50');
    if (!res.success) throw new Error('Failed to fetch options');
    return res.data?.items ?? res.data ?? [];
}

// ── メイン ────────────────────────────────────────────────────────────────────

async function main() {
    const reservationsOnly = args['reservations-only'];

    // 1. Firebase 認証
    await step('Firebase 認証', signIn);

    // 2. Custom Claims 同期（JWT にテナント情報を埋め込む）
    const claimsData = await step('Custom Claims 同期', syncClaims);
    console.log(`     tenantId: ${claimsData?.tenantId ?? '(sync済み)'}`);

    // 2b. トークンをリフレッシュ（新しいクレームを含む JWT を取得）
    await step('IDトークン リフレッシュ', refreshIdToken);

    // 3. 管理者コンテキスト
    const ctx = await step('管理者コンテキスト取得', fetchContext);
    console.log(`     tenantKey: ${ctx.tenantKey}, storeId: ${ctx.storeIds?.[0] ?? 'none'}`);

    let practitioners, menus, options;

    if (reservationsOnly) {
        // --reservations-only: 既存データを取得してスキップ
        practitioners = await step('施術者 取得（既存）', fetchExistingPractitioners);
        console.log(`     ${practitioners.length}名取得`);
        menus = await step('メニュー 取得（既存）', fetchExistingMenus);
        console.log(`     ${menus.length}件取得`);
        options = await step('オプション 取得（既存）', fetchExistingOptions);
        console.log(`     ${options.length}件取得`);
    } else {
        // 4. 施術者
        practitioners = await step(`施術者 ${PRACTITIONERS.length}名 作成`, createPractitioners);
        console.log(`     IDs: ${practitioners.map((p) => p.id).join(', ')}`);

        // 5. メニュー
        menus = await step(`メニュー ${8}件 作成`, () => createMenus(practitioners));
        console.log(`     IDs: ${menus.map((m) => m.id).join(', ')}`);

        // 6. オプション
        options = await step(`オプション ${4}件 作成`, () => createOptions(menus));
        console.log(`     IDs: ${options.map((o) => o.id).join(', ')}`);
    }

    // 7. 予約
    const reservations = await step('予約データ 作成', () => createReservations(practitioners, menus, options));
    const byStatus = reservations.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`     合計 ${reservations.length}件: ${Object.entries(byStatus).map(([k,v]) => `${k}=${v}`).join(', ')}`);

    console.log('\n🎉 シードデータ投入完了！');
    console.log(`\n📊 サマリー:`);
    if (!reservationsOnly) {
        console.log(`   施術者: ${practitioners.length}名`);
        console.log(`   メニュー: ${menus.length}件`);
        console.log(`   オプション: ${options.length}件`);
    }
    console.log(`   予約: ${reservations.length}件`);
    console.log(`\n🔗 管理画面: https://reserve-admin-czjwiprc2q-an.a.run.app`);
}

main().catch((err) => {
    console.error('\n💥 エラー:', err.message);
    process.exit(1);
});
