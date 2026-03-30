import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const adminState = vi.hoisted(() => ({
    requireFirebaseAuthCalls: 0,
    auth: {
        uid: 'admin-uid',
        role: 'manager',
        permissions: {
            canManagePractitioners: true,
            canManageSettings: true,
        },
    },
    tenant: {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'smoke-salon',
        name: 'Smoke Salon',
        plan: 'trial',
        status: 'active',
        branding: {},
        lineConfig: {
            mode: 'tenant',
        },
    },
    storeId: '22222222-2222-4222-8222-222222222222',
    customerRepoCalls: [] as string[],
    customerRepo: {
        findPaginatedWithFilters: vi.fn(),
    },
    storeRepo: {
        findById: vi.fn(),
        findAll: vi.fn(),
    },
    bookingLinkServiceTenantIds: [] as string[],
    bookingLinkService: {
        list: vi.fn(),
    },
    handleDailyAnalyticsRequest: vi.fn(),
}));

function requireFirebaseAuthMock() {
    return (req: any, _res: any, next: any) => {
        adminState.requireFirebaseAuthCalls += 1;
        req.user = {
            uid: adminState.auth.uid,
            role: adminState.auth.role,
            permissions: adminState.auth.permissions,
            tenantId: req.tenantId,
            storeIds: [adminState.storeId],
        };
        next();
    };
}

vi.mock('../../src/middleware/auth.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/middleware/auth.js')>('../../src/middleware/auth.js');
    return {
        ...actual,
        requireJwtTenant: () => (req: any, _res: any, next: any) => {
            req.tenantId = adminState.tenant.id;
            req.storeId = adminState.storeId;
            next();
        },
        requireFirebaseAuth: requireFirebaseAuthMock,
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
        requirePermission: (permission: string) => (req: any, _res: any, next: any) => {
            if (!req.user) {
                next({
                    statusCode: 401,
                    code: 'AUTHENTICATION_ERROR',
                    message: 'unauthenticated',
                });
                return;
            }
            if (req.user.role !== 'owner' && !req.user.permissions?.[permission]) {
                next({
                    statusCode: 403,
                    code: 'AUTHORIZATION_ERROR',
                    message: 'forbidden',
                });
                return;
            }
            next();
        },
    };
});

vi.mock('../../src/middleware/index.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/middleware/index.js')>('../../src/middleware/index.js');
    return {
        ...actual,
        requireJwtTenant: () => (req: any, _res: any, next: any) => {
            req.tenantId = adminState.tenant.id;
            req.storeId = adminState.storeId;
            next();
        },
        requireFirebaseAuth: requireFirebaseAuthMock,
    };
});

vi.mock('../../src/middleware/tenant.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/middleware/tenant.js')>('../../src/middleware/tenant.js');
    return {
        ...actual,
        getTenant: (req: any) => {
            if (req.tenantId !== adminState.tenant.id) {
                throw new Error(`unexpected tenantId: ${String(req.tenantId)}`);
            }
            return adminState.tenant;
        },
        getTenantId: (req: any) => {
            if (req.tenantId !== adminState.tenant.id) {
                throw new Error(`unexpected tenantId: ${String(req.tenantId)}`);
            }
            return req.tenantId;
        },
        getStoreId: (req: any) => req.storeId ?? null,
    };
});

vi.mock('../../src/repositories/customer.repository.js', () => ({
    CustomerRepository: class CustomerRepository {
        constructor(tenantId: string) {
            adminState.customerRepoCalls.push(tenantId);
        }

        findPaginatedWithFilters(...args: unknown[]) {
            return adminState.customerRepo.findPaginatedWithFilters(...args);
        }
    },
}));

vi.mock('../../src/repositories/tenant.repository.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/repositories/tenant.repository.js')>('../../src/repositories/tenant.repository.js');
    return {
        ...actual,
        createStoreRepository: () => adminState.storeRepo,
    };
});

vi.mock('../../src/services/booking-link-token.service.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/services/booking-link-token.service.js')>('../../src/services/booking-link-token.service.js');
    return {
        ...actual,
        createBookingLinkTokenService: (tenantId: string) => {
            adminState.bookingLinkServiceTenantIds.push(tenantId);
            return adminState.bookingLinkService;
        },
    };
});

vi.mock('../../src/jobs/daily-analytics.job.js', () => ({
    handleDailyAnalyticsRequest: (...args: unknown[]) => adminState.handleDailyAnalyticsRequest(...args),
}));

let adminV1Router: typeof import('../../src/routes/v1/admin-index.js').adminV1Router;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
    ({ adminV1Router } = await import('../../src/routes/v1/admin-index.js'));

    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminV1Router);
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
    if (!server) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

beforeEach(() => {
    adminState.requireFirebaseAuthCalls = 0;
    adminState.customerRepoCalls = [];
    adminState.bookingLinkServiceTenantIds = [];

    adminState.customerRepo.findPaginatedWithFilters.mockResolvedValue({
        data: [
            {
                id: 'customer-1',
                name: 'Test Customer',
            },
        ],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
    });

    adminState.storeRepo.findById.mockResolvedValue({
        id: adminState.storeId,
        tenantId: adminState.tenant.id,
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
    });
    adminState.storeRepo.findAll.mockResolvedValue([]);

    adminState.bookingLinkService.list.mockResolvedValue([
        {
            id: 'link-1',
            practitionerId: '33333333-3333-4333-8333-333333333333',
            status: 'active',
        },
    ]);

    adminState.handleDailyAnalyticsRequest.mockResolvedValue({
        success: true,
        stats: {
            targetDate: '2026-03-22',
            tenantsProcessed: 1,
            storesProcessed: 1,
            rowsUpserted: 2,
            failedTenants: 0,
        },
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

describe('admin v1 auth regression', () => {
    it('authenticates customer list requests once at the parent router', async () => {
        const { response, json } = await requestJson('/api/v1/admin/customers');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toHaveLength(1);
        expect(adminState.requireFirebaseAuthCalls).toBe(1);
        expect(adminState.customerRepoCalls).toEqual([adminState.tenant.id]);
    });

    it('preserves store context for settings routes without re-authenticating', async () => {
        const { response, json } = await requestJson('/api/v1/admin/settings');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.store.id).toBe(adminState.storeId);
        expect(adminState.requireFirebaseAuthCalls).toBe(1);
        expect(adminState.storeRepo.findById).toHaveBeenCalledWith(adminState.storeId);
    });

    it('keeps permission-guarded booking link routes working with parent auth', async () => {
        const { response, json } = await requestJson('/api/v1/admin/booking-links');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toHaveLength(1);
        expect(adminState.requireFirebaseAuthCalls).toBe(1);
        expect(adminState.bookingLinkServiceTenantIds).toEqual([adminState.tenant.id]);
    });

    it('runs admin job routes with a single auth pass', async () => {
        const { response, json } = await requestJson('/api/v1/admin/jobs/analytics/daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: '2026-03-22' }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(adminState.requireFirebaseAuthCalls).toBe(1);
        expect(adminState.handleDailyAnalyticsRequest).toHaveBeenCalledWith(
            '2026-03-22',
            adminState.tenant.id
        );
    });
});
