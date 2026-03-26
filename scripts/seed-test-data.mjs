#!/usr/bin/env node
/**
 * scripts/seed-test-data.mjs
 * Optional admin-API expander that layers high-variation practitioners,
 * menus, options, and reservation scenarios on top of the canonical SQL seed.
 */

import { parseArgs } from 'node:util';

const FIREBASE_API_KEY = 'AIzaSyDlgWGNiYP50yBRlFaWUdQg4NFSsHGx_Ro';
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const PLATFORM_API_PATH = '/api/platform/v1';
const ADMIN_API_PATH = '/api/v1/admin';
const SEED_NOTE_PREFIX = 'seed-expander:';
const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' });

const { values: args } = parseArgs({
    options: {
        email: { type: 'string' },
        password: { type: 'string' },
        api: { type: 'string', default: 'https://reserve-api-czjwiprc2q-an.a.run.app' },
        local: { type: 'boolean', default: false },
        'reservations-only': { type: 'boolean', default: false },
    },
    allowPositionals: true,
});

if (args.local) {
    args.api = 'http://localhost:3001';
}

if (!args.email || !args.password) {
    console.error('Usage: node scripts/seed-test-data.mjs --email=<email> --password=<password> [--api=<url>] [--local]');
    process.exit(1);
}

const API_BASE = args.api.replace(/\/$/, '');

console.log('\n🌱 seed-test-data expander');
console.log(`   API: ${API_BASE}`);
console.log(`   Email: ${args.email}\n`);

const PRACTITIONER_DEFS = [
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
            breakTime: { start: '12:00', end: '13:00' },
        },
        isActive: true,
        displayOrder: 1,
    },
    {
        name: '佐藤 健太',
        nameKana: 'さとう けんた',
        role: 'stylist',
        title: 'メンズスペシャリスト',
        email: 'kenta.sato@example.com',
        phone: '09087654321',
        description: 'メンズカットとヘッドスパを得意とするスタイリスト。',
        experience: '5年',
        specialties: ['メンズカット', 'ヘッドスパ', 'トリートメント'],
        color: '#3b82f6',
        nominationFee: 550,
        schedule: {
            workDays: [0, 1, 3, 4, 6],
            workHours: { start: '10:00', end: '20:00' },
            breakTime: { start: '13:00', end: '14:00' },
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
        description: 'シャンプー・トリートメントを丁寧に担当するアシスタント。',
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

const MENU_DEFS = [
    {
        name: 'カット',
        category: 'カット',
        description: 'シャンプー・ブロー込み。髪質に合わせたカット。',
        duration: 60,
        price: 6600,
        practitionerEmails: PRACTITIONER_DEFS.map((p) => p.email),
        displayOrder: 1,
    },
    {
        name: 'カット + カラー',
        category: 'カラー',
        description: 'カットとフルカラー。抜け感のあるデザイン。',
        duration: 150,
        price: 16500,
        practitionerEmails: [PRACTITIONER_DEFS[0].email, PRACTITIONER_DEFS[1].email],
        displayOrder: 2,
    },
    {
        name: 'カット + パーマ',
        category: 'パーマ',
        description: 'カット + デジタル/コールドパーマ。',
        duration: 180,
        price: 22000,
        practitionerEmails: [PRACTITIONER_DEFS[0].email],
        displayOrder: 3,
    },
    {
        name: 'トリートメント（単品）',
        category: 'トリートメント',
        description: '集中ケアトリートメント。',
        duration: 60,
        price: 5500,
        practitionerEmails: [],
        displayOrder: 4,
    },
    {
        name: 'ヘッドスパ',
        category: 'スパ・ケア',
        description: '頭皮マッサージつきの60分スパ。',
        duration: 60,
        price: 7700,
        practitionerEmails: [PRACTITIONER_DEFS[1].email],
        displayOrder: 5,
    },
    {
        name: 'カラー（リタッチ）',
        category: 'カラー',
        description: '根元リタッチで素早く仕上げます。',
        duration: 90,
        price: 8800,
        practitionerEmails: [PRACTITIONER_DEFS[0].email],
        displayOrder: 6,
    },
    {
        name: 'メンズカット',
        category: 'カット',
        description: '刈り上げ・フェード対応のメンズカット。',
        duration: 45,
        price: 4400,
        practitionerEmails: [PRACTITIONER_DEFS[1].email],
        displayOrder: 7,
    },
    {
        name: 'キッズカット（〜12歳）',
        category: 'カット',
        description: 'やさしい対応のキッズカット。',
        duration: 30,
        price: 2200,
        practitionerEmails: PRACTITIONER_DEFS.map((p) => p.email),
        displayOrder: 8,
    },
];

const OPTION_DEFS = [
    {
        name: 'プレミアムトリートメント',
        description: '保湿・補修を重視した集中トリートメント。',
        duration: 20,
        price: 3300,
        applicableMenuNames: ['カット', 'カット + カラー', 'カット + パーマ', 'トリートメント（単品）'],
        displayOrder: 1,
    },
    {
        name: '炭酸シャンプー',
        description: '炭酸の泡で頭皮クレンジング。',
        duration: 10,
        price: 1100,
        applicableMenuNames: ['カット', 'カット + カラー', 'カット + パーマ', 'トリートメント（単品）', 'ヘッドスパ'],
        displayOrder: 2,
    },
    {
        name: 'まゆげカット',
        description: '眉のバランスを整えるオプション。',
        duration: 10,
        price: 550,
        applicableMenuNames: ['カット', 'メンズカット'],
        displayOrder: 3,
    },
    {
        name: 'ヘアオイル（ホームケア）',
        description: 'スタイリング＋ホームケア用オイル。',
        duration: 0,
        price: 2200,
        applicableMenuNames: ['カット', 'カット + カラー', 'カット + パーマ'],
        displayOrder: 4,
    },
];

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

const RESERVATION_DEFS = [
    { key: 'past-completed-line', offsetDays: -28, time: '10:00', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['カット + カラー'], optionNames: ['プレミアムトリートメント'], customerIndex: 0, status: 'completed', source: 'line', isNomination: true },
    { key: 'past-completed-phone', offsetDays: -25, time: '14:00', practitionerEmail: PRACTITIONER_DEFS[1].email, menuNames: ['メンズカット'], optionNames: ['まゆげカット'], customerIndex: 4, status: 'completed', source: 'phone' },
    { key: 'past-canceled-web', offsetDays: -5, time: '10:30', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['カット'], optionNames: [], customerIndex: 1, status: 'canceled', source: 'web' },
    { key: 'today-confirmed-line', offsetDays: 0, time: '10:00', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['カット'], optionNames: ['炭酸シャンプー'], customerIndex: 3, status: 'confirmed', source: 'line' },
    { key: 'today-pending-admin', offsetDays: 0, time: '14:30', practitionerEmail: PRACTITIONER_DEFS[1].email, menuNames: ['メンズカット'], optionNames: [], customerIndex: 6, status: 'pending', source: 'admin' },
    { key: 'today-no-show', offsetDays: 0, time: '16:00', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['トリートメント（単品）'], optionNames: ['ヘアオイル（ホームケア）'], customerIndex: 7, status: 'no_show', source: 'walk_in' },
    { key: 'future-confirmed-phone', offsetDays: 7, time: '14:00', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['カラー（リタッチ）'], optionNames: [], customerIndex: 0, status: 'confirmed', source: 'phone' },
    { key: 'future-pending-web', offsetDays: 3, time: '15:00', practitionerEmail: PRACTITIONER_DEFS[0].email, menuNames: ['カット + パーマ'], optionNames: ['炭酸シャンプー'], customerIndex: 5, status: 'pending', source: 'web' },
    { key: 'future-completed-admin', offsetDays: 10, time: '11:00', practitionerEmail: PRACTITIONER_DEFS[1].email, menuNames: ['ヘッドスパ'], optionNames: [], customerIndex: 2, status: 'completed', source: 'admin' },
];

let idToken = '';
let refreshToken = '';
let storeId = '';

function request(path, { method = 'GET', body, auth = true, baseOverride } = {}) {
    const base = baseOverride ?? API_BASE;
    const url = `${base}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (auth && idToken) headers['Authorization'] = `Bearer ${idToken}`;
    return fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
}

async function adminPost(path, body) {
    const res = await request(`${ADMIN_API_PATH}${path}`, { method: 'POST', body });
    if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.json();
}

async function adminGet(path) {
    const res = await request(`${ADMIN_API_PATH}${path}`);
    if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.json();
}

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
    return data;
}

async function syncClaims() {
    const res = await request(`${PLATFORM_API_PATH}/admin/claims/sync`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`claims/sync failed: ${err?.message ?? res.status}`);
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.error?.message ?? 'claims/sync failed');
    return data.data;
}

async function fetchContext() {
    const res = await request(`${PLATFORM_API_PATH}/admin/context`);
    if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`context fetch failed: ${res.status}: ${text}`);
    }
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error?.message ?? 'context fetch failed');
    storeId = payload.data.storeIds?.[0] ?? '';
    return payload.data;
}

function step(label, fn) {
    process.stdout.write(`  ⏳ ${label}...`);
    return fn()
        .then((result) => {
            console.log(' ✅');
            return result;
        })
        .catch((error) => {
            console.log(' ❌');
            throw error;
        });
}

function tokyoDateString(offsetDays = 0) {
    const today = TOKYO_DATE_FORMATTER.format(new Date());
    const [year, month, day] = today.split('-').map((part) => Number(part));
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + offsetDays);
    return utcDate.toISOString().slice(0, 10);
}

function buildStartsAt(offsetDays, time) {
    return `${tokyoDateString(offsetDays)}T${time}:00+09:00`;
}

async function fetchExistingPractitioners() {
    const res = await adminGet('/practitioners?limit=200');
    return res.data?.items ?? res.data ?? [];
}

async function fetchExistingMenus() {
    const res = await adminGet('/menus?limit=200');
    return res.data?.items ?? res.data ?? [];
}

async function fetchExistingOptions() {
    const res = await adminGet('/options?limit=200');
    return res.data?.items ?? res.data ?? [];
}

async function ensurePractitioners() {
    const existing = await fetchExistingPractitioners();
    const byEmail = new Map(existing.map((p) => [p.email, p]));
    const byName = new Map(existing.map((p) => [p.name, p]));
    const created = [];
    const actual = [];
    for (const def of PRACTITIONER_DEFS) {
        const matched = byEmail.get(def.email) ?? byName.get(def.name);
        if (matched) {
            actual.push(matched);
            continue;
        }
        const body = {
            name: def.name,
            nameKana: def.nameKana,
            role: def.role,
            title: def.title,
            email: def.email,
            phone: def.phone,
            description: def.description,
            experience: def.experience,
            specialties: def.specialties,
            color: def.color,
            nominationFee: def.nominationFee,
            schedule: def.schedule,
            isActive: def.isActive,
            displayOrder: def.displayOrder,
        };
        if (storeId) body.storeIds = [storeId];
        const res = await adminPost('/practitioners', body);
        if (!res.success) {
            throw new Error(`practitioner create failed: ${JSON.stringify(res.error)}`);
        }
        actual.push(res.data);
        created.push(res.data);
        byEmail.set(def.email, res.data);
        byName.set(def.name, res.data);
        await new Promise((r) => setTimeout(r, 200));
    }
    if (created.length) {
        console.log(`     Practitioners created: ${created.map((p) => p.id).join(', ')}`);
    }
    return actual;
}

async function ensureMenus(practitioners) {
    const existing = await fetchExistingMenus();
    const existingMap = new Map(existing.map((menu) => [menu.name, menu]));
    const practitionerMap = new Map(practitioners.map((p) => [p.email, p]));
    const created = [];
    const result = [];
    for (const def of MENU_DEFS) {
        if (existingMap.has(def.name)) {
            result.push(existingMap.get(def.name));
            continue;
        }
        const availablePractitionerIds = def.practitionerEmails
            .map((email) => practitionerMap.get(email))
            .filter(Boolean)
            .map((p) => p.id);
        const body = {
            name: def.name,
            category: def.category,
            description: def.description,
            duration: def.duration,
            price: def.price,
            displayOrder: def.displayOrder,
        };
        if (availablePractitionerIds.length) {
            body.availablePractitionerIds = availablePractitionerIds;
        }
        const res = await adminPost('/menus', body);
        if (!res.success) {
            throw new Error(`menu create failed: ${JSON.stringify(res.error)}`);
        }
        result.push(res.data);
        created.push(res.data);
        await new Promise((r) => setTimeout(r, 200));
    }
    if (created.length) {
        console.log(`     Menus created: ${created.map((m) => m.id).join(', ')}`);
    }
    return result;
}

async function ensureOptions(menus) {
    const existing = await fetchExistingOptions();
    const existingMap = new Map(existing.map((option) => [option.name, option]));
    const menuMap = new Map(menus.map((m) => [m.name, m.id]));
    const created = [];
    const result = [];
    for (const def of OPTION_DEFS) {
        if (existingMap.has(def.name)) {
            result.push(existingMap.get(def.name));
            continue;
        }
        const applicableMenuIds = def.applicableMenuNames
            .map((name) => menuMap.get(name))
            .filter(Boolean);
        const body = {
            name: def.name,
            description: def.description,
            duration: def.duration,
            price: def.price,
            displayOrder: def.displayOrder,
        };
        if (applicableMenuIds.length) {
            body.applicableMenuIds = applicableMenuIds;
        }
        const res = await adminPost('/options', body);
        if (!res.success) {
            throw new Error(`option create failed: ${JSON.stringify(res.error)}`);
        }
        result.push(res.data);
        created.push(res.data);
        await new Promise((r) => setTimeout(r, 200));
    }
    if (created.length) {
        console.log(`     Options created: ${created.map((o) => o.id).join(', ')}`);
    }
    return result;
}

function buildReservationRequests(practitioners, menus, options) {
    const practitionerMap = new Map(practitioners.map((p) => [p.email, p]));
    const menuMap = new Map(menus.map((m) => [m.name, m]));
    const optionMap = new Map(options.map((o) => [o.name, o]));

    return RESERVATION_DEFS.map((def) => {
        const practitioner = practitionerMap.get(def.practitionerEmail);
        if (!practitioner) {
            throw new Error(`Practitioner ${def.practitionerEmail} is missing; run the base seed first.`);
        }
        const menuIds = def.menuNames
            .map((name) => menuMap.get(name)?.id)
            .filter(Boolean);
        if (!menuIds.length) {
            throw new Error(`Menus ${def.menuNames.join(', ')} not found for reservation ${def.key}.`);
        }
        const optionIds = def.optionNames
            .map((name) => optionMap.get(name)?.id)
            .filter(Boolean);
        const customer = CUSTOMERS[def.customerIndex];
        if (!customer) {
            throw new Error(`Customer index ${def.customerIndex} is out of bounds for reservation ${def.key}.`);
        }
        const startsAt = buildStartsAt(def.offsetDays, def.time);
        const postStatus = ['pending', 'confirmed'].includes(def.status) ? def.status : 'confirmed';
        return {
            key: def.key,
            practitionerId: practitioner.id,
            menuIds,
            optionIds,
            startsAt,
            timezone: 'Asia/Tokyo',
            desiredStatus: def.status,
            postStatus,
            source: def.source,
            customer,
            customerNote: `${SEED_NOTE_PREFIX}${def.key}`,
            staffNote: `seeded:${def.key}`,
            isNomination: Boolean(def.isNomination),
        };
    });
}

async function fetchSeedReservationsWindow() {
    const dateFrom = tokyoDateString(-30);
    const dateTo = tokyoDateString(30);
    const res = await adminGet(`/reservations?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=200`);
    return res.data?.items ?? res.data ?? [];
}

async function createReservations(practitioners, menus, options) {
    const requests = buildReservationRequests(practitioners, menus, options);
    const existing = await fetchSeedReservationsWindow();
    const existingNotes = new Set(existing
        .map((res) => res.customerNote)
        .filter((note) => typeof note === 'string' && note.startsWith(SEED_NOTE_PREFIX)));

    const created = [];
    let skipped = 0;

    for (const req of requests) {
        if (existingNotes.has(req.customerNote)) {
            skipped += 1;
            continue;
        }
        const body = {
            customerName: req.customer.name,
            customerPhone: req.customer.phone,
            customerEmail: req.customer.email,
            practitionerId: req.practitionerId,
            menuIds: req.menuIds,
            optionIds: req.optionIds,
            startsAt: req.startsAt,
            timezone: req.timezone,
            status: req.postStatus,
            source: req.source,
            customerNote: req.customerNote,
            staffNote: req.staffNote,
            isNomination: req.isNomination,
        };
        if (storeId) body.storeId = storeId;

        try {
            const res = await adminPost('/reservations', body);
            if (!res.success) {
                throw new Error(res.error?.message ?? 'reservation create failed');
            }
            const reservation = res.data;
            if (req.desiredStatus !== req.postStatus) {
                await adminPatch(`/reservations/${reservation.id}/status`, { status: req.desiredStatus });
                reservation.status = req.desiredStatus;
            }
            created.push(reservation);
            existingNotes.add(req.customerNote);
        } catch (err) {
            console.warn(`     ⚠️  reservation skipped (${req.key}): ${err.message}`);
            skipped += 1;
        }
        await new Promise((r) => setTimeout(r, 150));
    }

    if (skipped) {
        console.log(`     ${skipped} reservations skipped, ${created.length} created`);
    }
    return created;
}

async function adminPatch(path, body) {
    const res = await request(`${ADMIN_API_PATH}${path}`, { method: 'PATCH', body });
    if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`PATCH ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    const payload = await res.json();
    if (!payload.success) {
        throw new Error(payload.error?.message ?? `PATCH ${path} failed`);
    }
    return payload;
}

async function main() {
    const reservationsOnly = args['reservations-only'];

    await step('Firebase 認証', signIn);
    const claimsData = await step('Custom Claims 同期', syncClaims);
    console.log(`     tenantId: ${claimsData?.tenantId ?? '(sync済み)'}`);
    await step('IDトークン リフレッシュ', refreshIdToken);
    const ctx = await step('管理者コンテキスト取得', fetchContext);
    console.log(`     tenantKey: ${ctx.tenantKey}, storeId: ${ctx.storeIds?.[0] ?? 'none'}`);

    const practitioners = reservationsOnly
        ? await step('施術者 取得（既存）', fetchExistingPractitioners)
        : await step('施術者 確保', ensurePractitioners);

    const menus = reservationsOnly
        ? await step('メニュー 取得（既存）', fetchExistingMenus)
        : await step('メニュー 確保', () => ensureMenus(practitioners));

    const options = reservationsOnly
        ? await step('オプション 取得（既存）', fetchExistingOptions)
        : await step('オプション 確保', () => ensureOptions(menus));

    const reservations = await step('予約シナリオ 作成', () => createReservations(practitioners, menus, options));
    const byStatus = reservations.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`\n🎉 予約完了: ${reservations.length} 件 (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')})`);

    if (!reservationsOnly) {
        console.log(`\n✅ Practitioners: ${practitioners.length}`);
        console.log(`✅ Menus: ${menus.length}`);
        console.log(`✅ Options: ${options.length}`);
    }
    console.log('\n🔗 管理画面: https://reserve-admin-czjwiprc2q-an.a.run.app');
}

main().catch((err) => {
    console.error('\n💥 エラー:', err.message);
    process.exit(1);
});
