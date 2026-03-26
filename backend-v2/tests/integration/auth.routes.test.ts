import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authRouteState = vi.hoisted(() => ({
    verifyIdToken: vi.fn(),
    queryOne: vi.fn(),
    query: vi.fn(),
    publicStoreRepo: {
        findById: vi.fn(),
        findAll: vi.fn(),
    },
    publicPractitionerRepo: {
        findById: vi.fn(),
    },
    adminSettingsStoreRepo: {
        findById: vi.fn(),
        findAll: vi.fn(),
    },
    tenantNotificationRepo: {
        get: vi.fn(),
        upsert: vi.fn(),
    },
}));

vi.mock('../../src/config/firebase.js', () => ({
    initializeFirebase: vi.fn(),
    getAuthInstance: () => ({
        verifyIdToken: authRouteState.verifyIdToken,
    }),
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        queryOne: authRouteState.queryOne,
        query: authRouteState.query,
    },
}));

vi.mock('../../src/repositories/index.js', () => ({
    createStoreRepository: () => authRouteState.publicStoreRepo,
    createPractitionerRepository: () => authRouteState.publicPractitionerRepo,
    createTenantNotificationSettingsRepository: () => authRouteState.tenantNotificationRepo,
}));

vi.mock('../../src/repositories/tenant.repository.js', () => ({
    TenantRepository: class TenantRepository {},
    createStoreRepository: () => authRouteState.adminSettingsStoreRepo,
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

let resolveTenant: typeof import('../../src/middleware/tenant.js').resolveTenant;
let clearTenantCache: typeof import('../../src/middleware/tenant.js').clearTenantCache;
let requireJwtTenant: typeof import('../../src/middleware/auth.js').requireJwtTenant;
let requireFirebaseAuth: typeof import('../../src/middleware/auth.js').requireFirebaseAuth;
let authRoutes: typeof import('../../src/routes/v1/auth.routes.js').authRoutes;
let settingsRoutes: typeof import('../../src/routes/v1/settings.routes.js').default;
let server: Server;
let baseUrl: string;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID_A = '22222222-2222-4222-8222-222222222222';
const STORE_ID_B = '33333333-3333-4333-8333-333333333333';
const STORE_ID_FORBIDDEN = '44444444-4444-4444-8444-444444444444';
const PRACTITIONER_ID = '55555555-5555-4555-8555-555555555555';

function makeTenantRow(overrides: Record<string, unknown> = {}) {
    return {
        id: TENANT_ID,
        slug: 'smoke-salon-1773680978',
        name: 'Smoke Salon',
        plan: 'trial',
        status: 'active',
        onboarding_status: 'completed',
        onboarding_completed_at: null,
        onboarding_payload: null,
        line_mode: 'practitioner',
        line_channel_id: 'tenant-channel',
        line_channel_secret_encrypted: null,
        line_channel_access_token_encrypted: null,
        line_liff_id: 'tenant-liff',
        branding_primary_color: '#0f766e',
        branding_logo_url: 'https://example.com/logo.png',
        branding_favicon_url: null,
        stripe_customer_id: null,
        subscription_current_period_end: null,
        max_stores: 3,
        max_practitioners: 10,
        created_at: new Date('2026-03-22T00:00:00.000Z'),
        updated_at: new Date('2026-03-22T00:00:00.000Z'),
        ...overrides,
    };
}

function makeStore(id: string, name: string) {
    return {
        id,
        tenantId: TENANT_ID,
        storeCode: 'default000',
        name,
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
        lineConfig: {
            liffId: 'store-liff',
            channelId: 'store-channel',
        },
        status: 'active',
        displayOrder: 0,
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
        updatedAt: new Date('2026-03-22T00:00:00.000Z'),
    };
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const tenantModule = await import('../../src/middleware/tenant.js');
    ({ resolveTenant, clearTenantCache } = tenantModule);
    ({ requireJwtTenant, requireFirebaseAuth } = await import('../../src/middleware/auth.js'));
    ({ authRoutes } = await import('../../src/routes/v1/auth.routes.js'));
    ({ default: settingsRoutes } = await import('../../src/routes/v1/settings.routes.js'));

    const app = express();
    app.use(express.json());
    app.use('/api/v1/:tenantKey/auth', resolveTenant({ required: true }), authRoutes);
    app.use('/api/v1/admin/settings', requireJwtTenant(), requireFirebaseAuth(), settingsRoutes);
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
    authRouteState.verifyIdToken.mockResolvedValue({
        uid: 'firebase-admin-1',
        email: 'owner@example.com',
        tenantId: TENANT_ID,
    });

    authRouteState.queryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tenants WHERE slug = $1')) {
            return makeTenantRow({ slug: params?.[0] });
        }
        if (sql.includes('FROM tenants WHERE id = $1')) {
            return makeTenantRow();
        }
        if (sql.includes('SELECT * FROM admins WHERE tenant_id = $1 AND firebase_uid = $2')) {
            return {
                id: 'admin-1',
                tenant_id: TENANT_ID,
                firebase_uid: 'firebase-admin-1',
                role: 'owner',
                permissions: {
                    canManageSettings: true,
                },
                is_active: true,
                name: 'Owner Admin',
            };
        }
        if (sql.includes('SELECT id FROM stores WHERE id = $1 AND tenant_id = $2')) {
            return params?.[0] === STORE_ID_A ? { id: STORE_ID_A } : null;
        }
        return null;
    });

    authRouteState.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT store_id FROM admin_store_assignments')) {
            return [
                { store_id: STORE_ID_A },
                { store_id: STORE_ID_B },
            ];
        }
        if (sql.includes("SELECT id FROM stores WHERE tenant_id = $1 AND status = 'active'")) {
            return [
                { id: STORE_ID_A },
                { id: STORE_ID_B },
                { id: STORE_ID_FORBIDDEN },
            ];
        }
        return [];
    });

    authRouteState.publicStoreRepo.findById.mockResolvedValue(makeStore(STORE_ID_A, 'Public Main Store'));
    authRouteState.publicStoreRepo.findAll.mockResolvedValue([makeStore(STORE_ID_A, 'Public Main Store')]);
    authRouteState.publicPractitionerRepo.findById.mockResolvedValue({
        id: PRACTITIONER_ID,
        tenantId: TENANT_ID,
        name: '担当者',
        role: 'stylist',
        color: '#0f766e',
        schedule: {
            workDays: [1, 2, 3, 4, 5],
            workHours: { start: '10:00', end: '19:00' },
        },
        storeIds: [STORE_ID_A],
        availableMenuIds: [],
        displayOrder: 0,
        isActive: true,
        lineConfig: {
            liffId: 'practitioner-liff',
            channelId: 'practitioner-channel',
        },
        createdAt: new Date('2026-03-22T00:00:00.000Z'),
        updatedAt: new Date('2026-03-22T00:00:00.000Z'),
    });
    authRouteState.adminSettingsStoreRepo.findById.mockImplementation(async (id: string) => {
        if (id === STORE_ID_A) return makeStore(STORE_ID_A, 'Admin Main Store');
        if (id === STORE_ID_B) return makeStore(STORE_ID_B, 'Admin Branch Store');
        return null;
    });
    authRouteState.adminSettingsStoreRepo.findAll.mockResolvedValue([
        makeStore(STORE_ID_A, 'Admin Main Store'),
        makeStore(STORE_ID_B, 'Admin Branch Store'),
    ]);

    clearTenantCache();
});

afterEach(() => {
    vi.clearAllMocks();
    clearTenantCache();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('auth routes integration', () => {
    it('returns auth config for a hyphenated tenant slug with store and practitioner context', async () => {
        const { response, json } = await requestJson(
            `/api/v1/smoke-salon-1773680978/auth/config?storeId=${STORE_ID_A}&practitionerId=${PRACTITIONER_ID}`
        );

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.store.id).toBe(STORE_ID_A);
        expect(json.data.storeId).toBe(STORE_ID_A);
        expect(json.data.practitionerId).toBe(PRACTITIONER_ID);
        expect(json.data.lineConfigSource).toBe('practitioner');
    });

    it('rejects auth config when store scope is invalid for the tenant', async () => {
        authRouteState.queryOne.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM tenants WHERE slug = $1')) {
                return makeTenantRow();
            }
            if (sql.includes('SELECT id FROM stores WHERE id = $1 AND tenant_id = $2')) {
                return null;
            }
            return null;
        });
        authRouteState.publicStoreRepo.findById.mockResolvedValue(null);

        const { response, json } = await requestJson(
            `/api/v1/smoke-salon-1773680978/auth/config?storeId=${STORE_ID_FORBIDDEN}`
        );

        expect(response.status).toBe(403);
        expect(json.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 404 when auth config is requested with an invalid practitioner', async () => {
        authRouteState.publicPractitionerRepo.findById.mockResolvedValue(null);

        const { response, json } = await requestJson(
            `/api/v1/smoke-salon-1773680978/auth/config?storeId=${STORE_ID_A}&practitionerId=${PRACTITIONER_ID}`
        );

        expect(response.status).toBe(404);
        expect(json.error.code).toBe('NOT_FOUND');
    });

    it('applies the default scoped store to an authenticated admin route', async () => {
        const { response, json } = await requestJson('/api/v1/admin/settings', {
            headers: {
                Authorization: 'Bearer test-token',
            },
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.store.id).toBe(STORE_ID_A);
    });

    it('allows an explicitly requested store within admin scope', async () => {
        const { response, json } = await requestJson('/api/v1/admin/settings', {
            headers: {
                Authorization: 'Bearer test-token',
                'x-store-id': STORE_ID_B,
            },
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.store.id).toBe(STORE_ID_B);
    });

    it('rejects an explicitly requested store outside admin scope', async () => {
        const { response, json } = await requestJson('/api/v1/admin/settings', {
            headers: {
                Authorization: 'Bearer test-token',
                'x-store-id': STORE_ID_FORBIDDEN,
            },
        });

        expect(response.status).toBe(403);
        expect(json.error.code).toBe('AUTHORIZATION_ERROR');
        expect(authRouteState.adminSettingsStoreRepo.findById).not.toHaveBeenCalled();
    });
});
