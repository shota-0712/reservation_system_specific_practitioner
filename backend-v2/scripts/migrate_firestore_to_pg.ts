import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, Firestore } from 'firebase-admin/firestore';
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

type DocData = Record<string, any>;

const DRY_RUN = process.env.MIGRATE_DRY_RUN === 'true';
const PRESERVE_RAW = process.env.MIGRATE_PRESERVE_RAW === 'true';
const TENANT_FILTER = (process.env.MIGRATE_TENANT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'development-key-32-bytes-long!!';

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'app_user',
    password: process.env.DB_PASSWORD || 'change_me',
    database: process.env.DB_NAME || 'reservation_system',
});

function initFirestore(): Firestore {
    if (getApps().length > 0) {
        return getFirestore();
    }

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountPath) {
        if (!fs.existsSync(serviceAccountPath)) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT JSON not found');
        }
        const raw = fs.readFileSync(serviceAccountPath, 'utf8');
        const serviceAccount = JSON.parse(raw);
        initializeApp({
            credential: cert(serviceAccount as any),
        });
        return getFirestore();
    }

    initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID,
    });
    return getFirestore();
}

function isEncryptedValue(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    return parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

function encryptValue(value: string): string {
    if (!value) return value;
    if (isEncryptedValue(value)) return value;

    if (ENCRYPTION_KEY.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
    }

    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY, 'utf8').subarray(0, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function toDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

function formatTime(date: Date): string {
    return date.toISOString().split('T')[1].slice(0, 5);
}

function generateStoreCode(): string {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const length = 8;
    const randomBytes = crypto.randomBytes(length);
    let code = '';
    for (let i = 0; i < length; i++) {
        code += chars[randomBytes[i] % chars.length];
    }
    return code;
}

function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
}

function ensureUuid(id: string, map: Map<string, string>): string {
    if (uuidValidate(id)) return id;
    const existing = map.get(id);
    if (existing) return existing;
    const generated = uuidv4();
    map.set(id, generated);
    return generated;
}

async function setTenant(client: PoolClient, tenantId: string) {
    await client.query('SELECT set_tenant($1)', [tenantId]);
}

async function upsertTenant(client: PoolClient, tenant: DocData, tenantId: string) {
    const slug = tenant.slug || tenant.tenantSlug || generateSlug(tenant.name || `tenant-${tenantId.slice(0, 8)}`) || `tenant-${tenantId.slice(0, 8)}`;
    const lineConfig = tenant.lineConfig || tenant.line || {};
    const branding = tenant.branding || {};

    const values = {
        id: tenantId,
        slug,
        name: tenant.name || tenant.companyName || 'Unnamed Tenant',
        plan: tenant.plan || 'trial',
        status: tenant.status || 'trial',
        line_liff_id: lineConfig.liffId || tenant.liffId || null,
        line_channel_id: lineConfig.channelId || tenant.channelId || null,
        line_channel_access_token_encrypted: lineConfig.channelAccessToken ? encryptValue(lineConfig.channelAccessToken) : null,
        line_channel_secret_encrypted: lineConfig.channelSecret ? encryptValue(lineConfig.channelSecret) : null,
        branding_primary_color: branding.primaryColor || tenant.primaryColor || '#4F46E5',
        branding_logo_url: branding.logoUrl || null,
        branding_favicon_url: branding.faviconUrl || null,
        stripe_customer_id: tenant.stripeCustomerId || null,
        subscription_current_period_end: toDate(tenant.subscriptionCurrentPeriodEnd),
        max_stores: tenant.maxStores ?? null,
        max_practitioners: tenant.maxPractitioners ?? null,
        created_at: toDate(tenant.createdAt) || new Date(),
        updated_at: toDate(tenant.updatedAt) || new Date(),
    };

    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO tenants (
            id, slug, name, plan, status,
            line_liff_id, line_channel_id, line_channel_access_token_encrypted, line_channel_secret_encrypted,
            branding_primary_color, branding_logo_url, branding_favicon_url,
            stripe_customer_id, subscription_current_period_end, max_stores, max_practitioners,
            created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,
            $10,$11,$12,
            $13,$14,$15,$16,
            $17,$18
        )
        ON CONFLICT (id) DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            plan = EXCLUDED.plan,
            status = EXCLUDED.status,
            line_liff_id = EXCLUDED.line_liff_id,
            line_channel_id = EXCLUDED.line_channel_id,
            line_channel_access_token_encrypted = EXCLUDED.line_channel_access_token_encrypted,
            line_channel_secret_encrypted = EXCLUDED.line_channel_secret_encrypted,
            branding_primary_color = EXCLUDED.branding_primary_color,
            branding_logo_url = EXCLUDED.branding_logo_url,
            branding_favicon_url = EXCLUDED.branding_favicon_url,
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            subscription_current_period_end = EXCLUDED.subscription_current_period_end,
            max_stores = EXCLUDED.max_stores,
            max_practitioners = EXCLUDED.max_practitioners,
            updated_at = EXCLUDED.updated_at`,
        [
            values.id,
            values.slug,
            values.name,
            values.plan,
            values.status,
            values.line_liff_id,
            values.line_channel_id,
            values.line_channel_access_token_encrypted,
            values.line_channel_secret_encrypted,
            values.branding_primary_color,
            values.branding_logo_url,
            values.branding_favicon_url,
            values.stripe_customer_id,
            values.subscription_current_period_end,
            values.max_stores,
            values.max_practitioners,
            values.created_at,
            values.updated_at,
        ]
    );
}

function scheduleToWorkSchedule(schedule: any): Record<string, any> {
    if (!schedule) return {};
    const workDays = schedule.workDays || [];
    const workHours = schedule.workHours || {};
    const output: Record<string, any> = {};
    for (let day = 0; day <= 6; day++) {
        if (workDays.includes(day)) {
            output[String(day)] = {
                isWorking: true,
                startTime: workHours.start || '10:00',
                endTime: workHours.end || '20:00',
            };
        } else {
            output[String(day)] = { isWorking: false };
        }
    }
    return output;
}

async function upsertStore(client: PoolClient, store: DocData, tenantId: string, storeId: string) {
    const storeCodeRaw = store.storeCode || store.store_code;
    const storeCode = (typeof storeCodeRaw === 'string' && /^[a-z0-9]{8,10}$/.test(storeCodeRaw))
        ? storeCodeRaw
        : generateStoreCode();

    const businessHours = store.businessHours || store.business_hours;

    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO stores (
            id, tenant_id, name, store_code,
            address, phone, email, timezone,
            business_hours, regular_holidays, temporary_holidays, temporary_open_days,
            slot_duration, advance_booking_days, cancel_deadline_hours, require_phone, require_email,
            status, display_order,
            created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,
            $5,$6,$7,$8,
            $9,$10,$11,$12,
            $13,$14,$15,$16,$17,
            $18,$19,
            $20,$21
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            store_code = EXCLUDED.store_code,
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            email = EXCLUDED.email,
            timezone = EXCLUDED.timezone,
            business_hours = EXCLUDED.business_hours,
            regular_holidays = EXCLUDED.regular_holidays,
            temporary_holidays = EXCLUDED.temporary_holidays,
            temporary_open_days = EXCLUDED.temporary_open_days,
            slot_duration = EXCLUDED.slot_duration,
            advance_booking_days = EXCLUDED.advance_booking_days,
            cancel_deadline_hours = EXCLUDED.cancel_deadline_hours,
            require_phone = EXCLUDED.require_phone,
            require_email = EXCLUDED.require_email,
            status = EXCLUDED.status,
            display_order = EXCLUDED.display_order,
            updated_at = EXCLUDED.updated_at`,
        [
            storeId,
            tenantId,
            store.name || '店舗',
            storeCode,
            store.address || null,
            store.phone || null,
            store.email || null,
            store.timezone || 'Asia/Tokyo',
            businessHours || null,
            store.regularHolidays || [],
            store.temporaryHolidays || [],
            store.temporaryOpenDays || [],
            store.slotDuration ?? 30,
            store.advanceBookingDays ?? 30,
            store.cancelDeadlineHours ?? 24,
            store.requirePhone ?? true,
            store.requireEmail ?? false,
            store.status || 'active',
            store.displayOrder ?? 0,
            toDate(store.createdAt) || new Date(),
            toDate(store.updatedAt) || new Date(),
        ]
    );
}

async function upsertPractitioner(client: PoolClient, practitioner: DocData, tenantId: string, practitionerId: string, storeIds: string[]) {
    const schedule = practitioner.schedule || {};
    const workSchedule = practitioner.workSchedule || practitioner.work_schedule || scheduleToWorkSchedule(schedule);

    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO practitioners (
            id, tenant_id, name, role, name_kana, title, color, image_url, description, experience,
            pr_title, specialties, sns_instagram, sns_twitter,
            google_calendar_id, salonboard_staff_id,
            nomination_fee, work_schedule, store_ids,
            is_active, display_order, created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,
            $15,$16,
            $17,$18,$19,
            $20,$21,$22,$23
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            role = EXCLUDED.role,
            name_kana = EXCLUDED.name_kana,
            title = EXCLUDED.title,
            color = EXCLUDED.color,
            image_url = EXCLUDED.image_url,
            description = EXCLUDED.description,
            experience = EXCLUDED.experience,
            pr_title = EXCLUDED.pr_title,
            specialties = EXCLUDED.specialties,
            sns_instagram = EXCLUDED.sns_instagram,
            sns_twitter = EXCLUDED.sns_twitter,
            google_calendar_id = EXCLUDED.google_calendar_id,
            salonboard_staff_id = EXCLUDED.salonboard_staff_id,
            nomination_fee = EXCLUDED.nomination_fee,
            work_schedule = EXCLUDED.work_schedule,
            store_ids = EXCLUDED.store_ids,
            is_active = EXCLUDED.is_active,
            display_order = EXCLUDED.display_order,
            updated_at = EXCLUDED.updated_at`,
        [
            practitionerId,
            tenantId,
            practitioner.name || 'スタッフ',
            practitioner.role || 'stylist',
            practitioner.nameKana || null,
            practitioner.title || null,
            practitioner.color || '#3b82f6',
            practitioner.imageUrl || null,
            practitioner.description || null,
            practitioner.experience || null,
            practitioner.prTitle || null,
            practitioner.specialties || [],
            practitioner.snsInstagram || null,
            practitioner.snsTwitter || null,
            practitioner.calendarId || practitioner.googleCalendarId || null,
            practitioner.salonboardStaffId || null,
            practitioner.nominationFee ?? 0,
            workSchedule,
            storeIds,
            practitioner.isActive ?? true,
            practitioner.displayOrder ?? 0,
            toDate(practitioner.createdAt) || new Date(),
            toDate(practitioner.updatedAt) || new Date(),
        ]
    );
}

async function upsertMenu(client: PoolClient, menu: DocData, tenantId: string, menuId: string, practitionerIds: string[]) {
    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO menus (
            id, tenant_id, name, description, category,
            price, duration, image_url, is_active, display_order, practitioner_ids,
            created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,$11,
            $12,$13
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            duration = EXCLUDED.duration,
            image_url = EXCLUDED.image_url,
            is_active = EXCLUDED.is_active,
            display_order = EXCLUDED.display_order,
            practitioner_ids = EXCLUDED.practitioner_ids,
            updated_at = EXCLUDED.updated_at`,
        [
            menuId,
            tenantId,
            menu.name || 'メニュー',
            menu.description || null,
            menu.category || null,
            menu.price ?? 0,
            menu.duration ?? 30,
            menu.imageUrl || null,
            menu.isActive ?? true,
            menu.displayOrder ?? 0,
            practitionerIds,
            toDate(menu.createdAt) || new Date(),
            toDate(menu.updatedAt) || new Date(),
        ]
    );
}

async function upsertMenuOption(client: PoolClient, option: DocData, tenantId: string, optionId: string, applicableMenuIds: string[]) {
    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO menu_options (
            id, tenant_id, name, description, price, duration,
            applicable_menu_ids, is_active, display_order,
            created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,
            $10,$11
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            price = EXCLUDED.price,
            duration = EXCLUDED.duration,
            applicable_menu_ids = EXCLUDED.applicable_menu_ids,
            is_active = EXCLUDED.is_active,
            display_order = EXCLUDED.display_order,
            updated_at = EXCLUDED.updated_at`,
        [
            optionId,
            tenantId,
            option.name || 'オプション',
            option.description || null,
            option.price ?? 0,
            option.duration ?? 0,
            applicableMenuIds,
            option.isActive ?? true,
            option.displayOrder ?? 0,
            toDate(option.createdAt) || new Date(),
            toDate(option.updatedAt) || new Date(),
        ]
    );
}

async function upsertCustomer(client: PoolClient, customer: DocData, tenantId: string, customerId: string) {
    const attributes = PRESERVE_RAW ? customer : (customer.attributes || {});

    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO customers (
            id, tenant_id, name, name_kana, email, phone,
            line_user_id, line_display_name, line_picture_url,
            birthday, gender,
            total_visits, total_spend, average_spend,
            last_visit_at, first_visit_at, rfm_segment,
            tags, notes, attributes, notification_settings, notification_token,
            is_active, created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,
            $10,$11,
            $12,$13,$14,
            $15,$16,$17,
            $18,$19,$20,$21,$22,
            $23,$24,$25
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            name_kana = EXCLUDED.name_kana,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            line_user_id = EXCLUDED.line_user_id,
            line_display_name = EXCLUDED.line_display_name,
            line_picture_url = EXCLUDED.line_picture_url,
            birthday = EXCLUDED.birthday,
            gender = EXCLUDED.gender,
            total_visits = EXCLUDED.total_visits,
            total_spend = EXCLUDED.total_spend,
            average_spend = EXCLUDED.average_spend,
            last_visit_at = EXCLUDED.last_visit_at,
            first_visit_at = EXCLUDED.first_visit_at,
            rfm_segment = EXCLUDED.rfm_segment,
            tags = EXCLUDED.tags,
            notes = EXCLUDED.notes,
            attributes = EXCLUDED.attributes,
            notification_settings = EXCLUDED.notification_settings,
            notification_token = EXCLUDED.notification_token,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at`,
        [
            customerId,
            tenantId,
            customer.name || customer.lineDisplayName || 'ゲスト',
            customer.nameKana || null,
            customer.email || null,
            customer.phone || null,
            customer.lineUserId || null,
            customer.lineDisplayName || null,
            customer.linePictureUrl || null,
            customer.birthday || customer.birthDate || null,
            customer.gender || null,
            customer.totalVisits ?? 0,
            customer.totalSpend ?? 0,
            customer.averageSpend ?? 0,
            toDate(customer.lastVisitAt) || null,
            toDate(customer.firstVisitAt) || null,
            customer.rfmSegment || null,
            customer.tags || [],
            customer.memo || customer.notes || null,
            attributes,
            customer.notificationSettings || {},
            customer.notificationToken || null,
            customer.isActive ?? true,
            toDate(customer.createdAt) || new Date(),
            toDate(customer.updatedAt) || new Date(),
        ]
    );
}

function computeEndTime(startTime: string, duration: number): string {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + duration;
    const endHour = Math.floor(totalMinutes / 60) % 24;
    const endMin = totalMinutes % 60;
    return `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
}

async function upsertReservation(client: PoolClient, reservation: DocData, tenantId: string, reservationId: string, maps: {
    customer: Map<string, string>;
    practitioner: Map<string, string>;
    menu: Map<string, string>;
    option: Map<string, string>;
    store: Map<string, string>;
}) {
    const startAt = toDate(reservation.startAt || reservation.start_time || reservation.startTime);
    const endAt = toDate(reservation.endAt || reservation.end_time || reservation.endTime);
    const dateValue = reservation.date || (startAt ? formatDate(startAt) : null);
    const startTimeValue = reservation.startTime || reservation.start_time || (startAt ? formatTime(startAt) : null);

    if (!dateValue || !startTimeValue) {
        return;
    }

    const duration = reservation.duration ?? reservation.totalDuration ?? (startAt && endAt ? Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000)) : 0);
    const endTimeValue = reservation.endTime || reservation.end_time || (endAt ? formatTime(endAt) : computeEndTime(startTimeValue, duration));

    const rawCustomerId = reservation.customerId || reservation.customer_id;
    const rawPractitionerId = reservation.practitionerId || reservation.practitioner_id;
    if (!rawCustomerId || !rawPractitionerId) {
        return;
    }

    const customerId = ensureUuid(rawCustomerId, maps.customer);
    const practitionerId = ensureUuid(rawPractitionerId, maps.practitioner);
    const storeId = reservation.storeId || reservation.store_id ? ensureUuid(reservation.storeId || reservation.store_id, maps.store) : null;

    const status = reservation.status || 'pending';
    const source = reservation.source || 'line';

    const subtotal = reservation.subtotal ?? reservation.menuPrice ?? 0;
    const optionTotal = reservation.optionTotal ?? reservation.optionsPrice ?? 0;
    const nominationFee = reservation.nominationFee ?? 0;
    const discount = reservation.discount ?? 0;
    const totalPrice = reservation.totalPrice ?? reservation.price ?? (subtotal + optionTotal + nominationFee - discount);

    const attributes = PRESERVE_RAW ? reservation : (reservation.attributes || {});

    if (DRY_RUN) return;

    const row = await client.query(
        `INSERT INTO reservations (
            id, tenant_id, store_id, customer_id, practitioner_id,
            period, date, start_time, end_time,
            status, source,
            subtotal, option_total, nomination_fee, discount, total_price,
            total_duration,
            customer_name, customer_phone, practitioner_name,
            notes, internal_note,
            google_calendar_event_id, salonboard_reservation_id,
            attributes, canceled_at, cancel_reason,
            created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,
            tstzrange(
                ($6::date || ' ' || $7 || ':00')::timestamptz AT TIME ZONE 'Asia/Tokyo',
                ($6::date || ' ' || $8 || ':00')::timestamptz AT TIME ZONE 'Asia/Tokyo',
                '[)'
            ),
            $6,$7,$8,
            $9,$10,
            $11,$12,$13,$14,$15,
            $16,
            $17,$18,$19,
            $20,$21,
            $22,$23,
            $24,$25,$26,
            $27,$28
        )
        ON CONFLICT (id) DO UPDATE SET
            store_id = EXCLUDED.store_id,
            customer_id = EXCLUDED.customer_id,
            practitioner_id = EXCLUDED.practitioner_id,
            period = EXCLUDED.period,
            date = EXCLUDED.date,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            status = EXCLUDED.status,
            source = EXCLUDED.source,
            subtotal = EXCLUDED.subtotal,
            option_total = EXCLUDED.option_total,
            nomination_fee = EXCLUDED.nomination_fee,
            discount = EXCLUDED.discount,
            total_price = EXCLUDED.total_price,
            total_duration = EXCLUDED.total_duration,
            customer_name = EXCLUDED.customer_name,
            customer_phone = EXCLUDED.customer_phone,
            practitioner_name = EXCLUDED.practitioner_name,
            notes = EXCLUDED.notes,
            internal_note = EXCLUDED.internal_note,
            google_calendar_event_id = EXCLUDED.google_calendar_event_id,
            salonboard_reservation_id = EXCLUDED.salonboard_reservation_id,
            attributes = EXCLUDED.attributes,
            canceled_at = EXCLUDED.canceled_at,
            cancel_reason = EXCLUDED.cancel_reason,
            updated_at = EXCLUDED.updated_at
        RETURNING id`,
        [
            reservationId,
            tenantId,
            storeId,
            customerId,
            practitionerId,
            dateValue,
            startTimeValue,
            endTimeValue,
            status,
            source,
            subtotal,
            optionTotal,
            nominationFee,
            discount,
            totalPrice,
            duration,
            reservation.customerName || null,
            reservation.customerPhone || null,
            reservation.practitionerName || null,
            reservation.customerNote || reservation.notes || null,
            reservation.staffNote || reservation.internalNote || null,
            reservation.googleCalendarEventId || null,
            reservation.salonboardReservationId || null,
            attributes,
            toDate(reservation.canceledAt) || null,
            reservation.cancelReason || null,
            toDate(reservation.createdAt) || new Date(),
            toDate(reservation.updatedAt) || new Date(),
        ]
    );

    if (!row.rows[0]?.id) {
        return;
    }

    await client.query('DELETE FROM reservation_menus WHERE tenant_id = $1 AND reservation_id = $2', [tenantId, reservationId]);
    await client.query('DELETE FROM reservation_options WHERE tenant_id = $1 AND reservation_id = $2', [tenantId, reservationId]);

    const menus = reservation.menus || reservation.menuItems || [];
    const menuIds = reservation.menuIds || reservation.menu_ids || [];
    const menuNames = reservation.menuNames || reservation.menu_names || [];

    const resolvedMenuItems: Array<{ menuId: string; menuName: string; menuPrice: number; menuDuration: number }> = [];

    if (Array.isArray(menus) && menus.length > 0) {
        menus.forEach((m: any) => {
            const id = m.menuId || m.id;
            if (!id) return;
            resolvedMenuItems.push({
                menuId: ensureUuid(id, maps.menu),
                menuName: m.menuName || m.name || 'メニュー',
                menuPrice: m.menuPrice ?? m.price ?? 0,
                menuDuration: m.menuDuration ?? m.duration ?? 0,
            });
        });
    } else if (Array.isArray(menuIds) && menuIds.length > 0) {
        menuIds.forEach((id: string, index: number) => {
            const mappedId = ensureUuid(id, maps.menu);
            resolvedMenuItems.push({
                menuId: mappedId,
                menuName: menuNames[index] || 'メニュー',
                menuPrice: 0,
                menuDuration: 0,
            });
        });
    }

    for (let i = 0; i < resolvedMenuItems.length; i++) {
        const item = resolvedMenuItems[i];
        await client.query(
            `INSERT INTO reservation_menus (
                tenant_id, reservation_id, menu_id,
                menu_name, menu_price, menu_duration,
                sort_order, is_main, quantity
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                tenantId,
                reservationId,
                item.menuId,
                item.menuName,
                item.menuPrice,
                item.menuDuration,
                i,
                i === 0,
                1,
            ]
        );
    }

    const options = reservation.options || reservation.optionItems || [];
    const optionIds = reservation.optionIds || reservation.option_ids || [];
    const optionNames = reservation.optionNames || reservation.option_names || [];

    const resolvedOptionItems: Array<{ optionId: string; optionName: string; optionPrice: number; optionDuration: number }> = [];

    if (Array.isArray(options) && options.length > 0) {
        options.forEach((o: any) => {
            const id = o.optionId || o.id;
            if (!id) return;
            resolvedOptionItems.push({
                optionId: ensureUuid(id, maps.option),
                optionName: o.optionName || o.name || 'オプション',
                optionPrice: o.optionPrice ?? o.price ?? 0,
                optionDuration: o.optionDuration ?? o.duration ?? 0,
            });
        });
    } else if (Array.isArray(optionIds) && optionIds.length > 0) {
        optionIds.forEach((id: string, index: number) => {
            resolvedOptionItems.push({
                optionId: ensureUuid(id, maps.option),
                optionName: optionNames[index] || 'オプション',
                optionPrice: 0,
                optionDuration: 0,
            });
        });
    }

    for (const item of resolvedOptionItems) {
        await client.query(
            `INSERT INTO reservation_options (
                tenant_id, reservation_id, option_id,
                option_name, option_price, option_duration
            ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [
                tenantId,
                reservationId,
                item.optionId,
                item.optionName,
                item.optionPrice,
                item.optionDuration,
            ]
        );
    }
}

async function upsertAdmin(client: PoolClient, admin: DocData, tenantId: string, adminId: string) {
    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO admins (
            id, tenant_id, firebase_uid, name, email, role, permissions,
            store_ids, is_active, created_at, updated_at
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11
        )
        ON CONFLICT (id) DO UPDATE SET
            firebase_uid = EXCLUDED.firebase_uid,
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            permissions = EXCLUDED.permissions,
            store_ids = EXCLUDED.store_ids,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at`,
        [
            adminId,
            tenantId,
            admin.firebaseUid || admin.uid || '',
            admin.name || '管理者',
            admin.email || null,
            admin.role || 'owner',
            admin.permissions || {},
            admin.storeIds || [],
            admin.isActive ?? true,
            toDate(admin.createdAt) || new Date(),
            toDate(admin.updatedAt) || new Date(),
        ]
    );
}

async function upsertSetting(client: PoolClient, setting: DocData, tenantId: string, settingId: string, storeId: string | null) {
    if (DRY_RUN) return;

    await client.query(
        `INSERT INTO settings (
            id, tenant_id, store_id,
            shop_name, shop_description, shop_image_url,
            notification_new_reservation, notification_cancellation, notification_reminder, reminder_hours_before,
            message_templates, attributes, created_at, updated_at
        ) VALUES (
            $1,$2,$3,
            $4,$5,$6,
            $7,$8,$9,$10,
            $11,$12,$13,$14
        )
        ON CONFLICT (tenant_id, store_id) DO UPDATE SET
            shop_name = EXCLUDED.shop_name,
            shop_description = EXCLUDED.shop_description,
            shop_image_url = EXCLUDED.shop_image_url,
            notification_new_reservation = EXCLUDED.notification_new_reservation,
            notification_cancellation = EXCLUDED.notification_cancellation,
            notification_reminder = EXCLUDED.notification_reminder,
            reminder_hours_before = EXCLUDED.reminder_hours_before,
            message_templates = EXCLUDED.message_templates,
            attributes = EXCLUDED.attributes,
            updated_at = EXCLUDED.updated_at`,
        [
            settingId,
            tenantId,
            storeId,
            setting.shopName || setting.shop_name || null,
            setting.shopDescription || setting.shop_description || null,
            setting.shopImageUrl || null,
            setting.notificationNewReservation ?? true,
            setting.notificationCancellation ?? true,
            setting.notificationReminder ?? true,
            setting.reminderHoursBefore ?? 24,
            setting.messageTemplates || {},
            setting.attributes || {},
            toDate(setting.createdAt) || new Date(),
            toDate(setting.updatedAt) || new Date(),
        ]
    );
}

async function getDocsForTenant(db: Firestore, tenantId: string, collectionName: string): Promise<Array<{ id: string; data: DocData }>> {
    const subCollection = await db.collection('tenants').doc(tenantId).collection(collectionName).get();
    if (!subCollection.empty) {
        return subCollection.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    }

    const top = await db.collection(collectionName).where('tenantId', '==', tenantId).get();
    if (!top.empty) {
        return top.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    }

    return [];
}

async function migrateTenant(db: Firestore, tenantDoc: { id: string; data: DocData }) {
    if (TENANT_FILTER.length > 0 && !TENANT_FILTER.includes(tenantDoc.id)) {
        return;
    }

    const tenantIdMap = new Map<string, string>();
    const storeIdMap = new Map<string, string>();
    const practitionerIdMap = new Map<string, string>();
    const menuIdMap = new Map<string, string>();
    const optionIdMap = new Map<string, string>();
    const customerIdMap = new Map<string, string>();
    const reservationIdMap = new Map<string, string>();
    const adminIdMap = new Map<string, string>();
    const settingIdMap = new Map<string, string>();

    const tenantId = ensureUuid(tenantDoc.id, tenantIdMap);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await upsertTenant(client, tenantDoc.data, tenantId);
        await setTenant(client, tenantId);

        const stores = await getDocsForTenant(db, tenantDoc.id, 'stores');
        const storeIds: string[] = [];
        for (const store of stores) {
            const storeId = ensureUuid(store.id, storeIdMap);
            storeIds.push(storeId);
            await upsertStore(client, store.data, tenantId, storeId);
        }

        const practitioners = await getDocsForTenant(db, tenantDoc.id, 'practitioners');
        for (const practitioner of practitioners) {
            const practitionerId = ensureUuid(practitioner.id, practitionerIdMap);
            const mappedStoreIds = (practitioner.data.storeIds || []).map((id: string) => ensureUuid(id, storeIdMap));
            const fallbackStoreIds = mappedStoreIds.length > 0 ? mappedStoreIds : storeIds;
            await upsertPractitioner(client, practitioner.data, tenantId, practitionerId, fallbackStoreIds);
        }

        const menus = await getDocsForTenant(db, tenantDoc.id, 'menus');
        for (const menu of menus) {
            const menuId = ensureUuid(menu.id, menuIdMap);
            const practitionerIds = (menu.data.availablePractitionerIds || menu.data.practitionerIds || []).map((id: string) => ensureUuid(id, practitionerIdMap));
            await upsertMenu(client, menu.data, tenantId, menuId, practitionerIds);
        }

        const options = await getDocsForTenant(db, tenantDoc.id, 'menu_options');
        const optionsAlt = options.length === 0 ? await getDocsForTenant(db, tenantDoc.id, 'menuOptions') : [];
        const menuOptions = options.length > 0 ? options : optionsAlt;
        for (const option of menuOptions) {
            const optionId = ensureUuid(option.id, optionIdMap);
            const applicableMenuIds = (option.data.applicableMenuIds || option.data.applicable_menu_ids || []).map((id: string) => ensureUuid(id, menuIdMap));
            await upsertMenuOption(client, option.data, tenantId, optionId, applicableMenuIds);
        }

        const customers = await getDocsForTenant(db, tenantDoc.id, 'customers');
        for (const customer of customers) {
            const customerId = ensureUuid(customer.id, customerIdMap);
            await upsertCustomer(client, customer.data, tenantId, customerId);
        }

        const reservations = await getDocsForTenant(db, tenantDoc.id, 'reservations');
        for (const reservation of reservations) {
            const reservationId = ensureUuid(reservation.id, reservationIdMap);
            await upsertReservation(client, reservation.data, tenantId, reservationId, {
                customer: customerIdMap,
                practitioner: practitionerIdMap,
                menu: menuIdMap,
                option: optionIdMap,
                store: storeIdMap,
            });
        }

        const admins = await getDocsForTenant(db, tenantDoc.id, 'admins');
        for (const admin of admins) {
            const adminId = ensureUuid(admin.id, adminIdMap);
            const mappedStoreIds = (admin.data.storeIds || []).map((id: string) => ensureUuid(id, storeIdMap));
            await upsertAdmin(client, { ...admin.data, storeIds: mappedStoreIds }, tenantId, adminId);
        }

        const settings = await getDocsForTenant(db, tenantDoc.id, 'settings');
        for (const setting of settings) {
            const settingId = ensureUuid(setting.id, settingIdMap);
            const storeIdRaw = setting.data.storeId || setting.data.store_id;
            const storeId = storeIdRaw ? ensureUuid(storeIdRaw, storeIdMap) : (storeIds[0] ?? null);
            await upsertSetting(client, setting.data, tenantId, settingId, storeId);
        }

        if (DRY_RUN) {
            await client.query('ROLLBACK');
        } else {
            await client.query('COMMIT');
        }
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function main() {
    const db = initFirestore();
    const tenantsSnapshot = await db.collection('tenants').get();

    if (tenantsSnapshot.empty) {
        const tenantId = process.env.MIGRATE_TENANT_ID;
        if (!tenantId) {
            throw new Error('No tenants found. Set MIGRATE_TENANT_ID to migrate without tenants collection.');
        }
        await migrateTenant(db, { id: tenantId, data: { name: 'Legacy Tenant', slug: generateSlug('legacy-tenant') } });
        return;
    }

    const tenants = tenantsSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    for (const tenant of tenants) {
        await migrateTenant(db, tenant);
    }
}

main()
    .then(() => {
        console.log(`✅ Migration finished${DRY_RUN ? ' (dry run)' : ''}`);
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Migration failed', err);
        process.exit(1);
    })
    .finally(async () => {
        await pool.end();
    });
