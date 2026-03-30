import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const settingsState = vi.hoisted(() => ({
    auth: {
        uid: 'admin-uid',
        role: 'manager',
    },
    tenant: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'smoke-salon',
        name: 'Smoke Salon',
        plan: 'trial',
        status: 'active',
        branding: {
            primaryColor: '#0f766e',
            logoUrl: 'https://example.com/logo.png',
        },
        lineConfig: {
            mode: 'tenant',
            channelId: 'tenant-channel',
            liffId: 'tenant-liff',
        },
    },
    storeId: undefined as string | undefined,
    storeRepo: {
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
    },
    notificationRepo: {
        get: vi.fn(),
        upsert: vi.fn(),
    },
    brandingLogoService: {
        uploadTenantBrandingLogo: vi.fn(),
    },
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (req: any, _res: any, next: any) => {
        req.user = {
            uid: settingsState.auth.uid,
            role: settingsState.auth.role,
        };
        next();
    },
    requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => {
        if (!req.user || !roles.includes(req.user.role)) {
            next({
                statusCode: 403,
                code: 'AUTHORIZATION_ERROR',
                message: 'forbidden',
            });
            return;
        }
        next();
    },
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenant: () => settingsState.tenant,
    getTenantId: () => settingsState.tenant.id,
    getStoreId: () => settingsState.storeId ?? null,
}));

vi.mock('../../src/repositories/tenant.repository.js', () => ({
    TenantRepository: class TenantRepository {},
    createStoreRepository: () => settingsState.storeRepo,
}));

vi.mock('../../src/repositories/index.js', () => ({
    createPractitionerRepository: vi.fn(),
    createTenantNotificationSettingsRepository: () => settingsState.notificationRepo,
}));

vi.mock('../../src/services/branding-logo.service.js', () => ({
    uploadTenantBrandingLogo: (...args: unknown[]) =>
        settingsState.brandingLogoService.uploadTenantBrandingLogo(...args),
}));

let settingsRoutes: typeof import('../../src/routes/v1/settings.routes.js').default;
let server: Server;
let baseUrl: string;

const STORE_ID = '22222222-2222-4222-8222-222222222222';

function makeStore() {
    return {
        id: STORE_ID,
        tenantId: settingsState.tenant.id,
        storeCode: 'default000',
        name: 'Main Store',
        address: 'Tokyo',
        phone: '03-0000-0000',
        email: 'store@example.com',
        timezone: 'Asia/Tokyo',
        businessHours: {},
        regularHolidays: [],
        temporaryHolidays: [],
        temporaryOpenDays: [],
        slotDuration: 30,
        advanceBookingDays: 30,
        cancelDeadlineHours: 24,
        requirePhone: true,
        requireEmail: false,
        status: 'active',
        displayOrder: 0,
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
        updatedAt: new Date('2026-03-22T00:00:00.000Z'),
    };
}

beforeAll(async () => {
    ({ default: settingsRoutes } = await import('../../src/routes/v1/settings.routes.js'));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
        req.user = {
            uid: settingsState.auth.uid,
            role: settingsState.auth.role,
        };
        next();
    });
    app.use('/settings', settingsRoutes);
    app.use((error: any, _req: any, res: any, _next: any) => {
        res.status(error?.statusCode ?? 500).json({
            success: false,
            error: {
                code: error?.code ?? 'INTERNAL_ERROR',
                message: error?.message ?? 'unexpected error',
            },
        });
    });

    server = await new Promise<Server>((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

beforeEach(() => {
    settingsState.auth = {
        uid: 'admin-uid',
        role: 'manager',
    };
    settingsState.storeId = undefined;
    settingsState.storeRepo.findById.mockResolvedValue(makeStore());
    settingsState.storeRepo.findAll.mockResolvedValue([makeStore()]);
    settingsState.notificationRepo.get.mockResolvedValue({
        emailNewReservation: true,
        emailCancellation: true,
        emailDailyReport: false,
        lineReminder: true,
        lineConfirmation: true,
        lineReview: false,
        pushNewReservation: false,
        pushCancellation: true,
    });
    settingsState.notificationRepo.upsert.mockResolvedValue({
        emailNewReservation: true,
        emailCancellation: true,
        emailDailyReport: false,
        lineReminder: false,
        lineConfirmation: true,
        lineReview: false,
        pushNewReservation: false,
        pushCancellation: true,
        updatedBy: 'admin-uid',
    });
    settingsState.brandingLogoService.uploadTenantBrandingLogo.mockResolvedValue({
        logoUrl: 'https://storage.example/logo.png',
        objectPath: 'tenant-assets/tenant-1/branding/logo.png',
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('settings routes integration', () => {
    it('returns tenant and scoped store settings', async () => {
        const { response, json } = await requestJson('/settings');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.tenant.slug).toBe('smoke-salon');
        expect(json.data.store.id).toBe(STORE_ID);
    });

    it('returns tenant notification settings', async () => {
        const { response, json } = await requestJson('/settings/notifications');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.lineReminder).toBe(true);
    });

    it('updates tenant notification settings', async () => {
        const { response, json } = await requestJson('/settings/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineReminder: false }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.lineReminder).toBe(false);
        expect(settingsState.notificationRepo.upsert).toHaveBeenCalledWith(
            { lineReminder: false },
            'admin-uid'
        );
    });

    it('allows managers to update store profile settings', async () => {
        settingsState.storeRepo.update.mockResolvedValue({
            ...makeStore(),
            name: 'Updated Store',
        });

        const { response, json } = await requestJson('/settings/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated Store' }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(settingsState.storeRepo.update).toHaveBeenCalledWith(STORE_ID, {
            name: 'Updated Store',
        });
    });

    it('does not accept legacy PUT for partial profile updates', async () => {
        const { response } = await requestJson('/settings/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated Store' }),
        });

        expect(response.status).toBe(404);
    });

    it('uploads branding logo via backend storage', async () => {
        const { response, json } = await requestJson('/settings/branding/logo-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: 'logo.png',
                contentType: 'image/png',
                dataBase64: Buffer.from('logo-binary').toString('base64'),
            }),
        });

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.data.logoUrl).toBe('https://storage.example/logo.png');
        expect(settingsState.brandingLogoService.uploadTenantBrandingLogo).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: settingsState.tenant.id,
                fileName: 'logo.png',
                contentType: 'image/png',
                bytes: expect.any(Buffer),
            })
        );
    });
});
