import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

process.env.JOB_SECRET = 'job-secret';

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (_req: any, _res: any, next: any) => next(),
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenantId: () => 'tenant-a',
}));

vi.mock('../../src/middleware/error-handler.js', () => ({
    asyncHandler: (handler: any) => async (req: any, res: any, next: any) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    },
}));

const writeAuditLog = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/audit-log.service.js', () => ({
    getRequestMeta: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
    writeAuditLog,
}));

const createSalonboardService = vi.fn();
vi.mock('../../src/services/salonboard.service.js', () => ({
    createSalonboardService,
}));

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

async function invokeRoute(router: any, method: RouteMethod, path: string, body: any = {}, headers: Record<string, string> = {}) {
    const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods?.[method]);
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    }

    const handlers = layer.route.stack.map((routeLayer: any) => routeLayer.handle);
    const req: any = {
        method: method.toUpperCase(),
        path,
        query: {},
        params: {},
        headers,
        body,
        user: { uid: 'admin-uid', name: '管理者' },
    };
    const res: any = {
        statusCode: 200,
        payload: undefined,
        headers: {} as Record<string, string>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        setHeader(key: string, value: string) {
            this.headers[key] = value;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
        send(payload: any) {
            this.payload = payload;
            return this;
        },
    };

    let index = 0;
    const next = async (error?: unknown) => {
        if (error) {
            throw error;
        }
        const handler = handlers[index++];
        if (!handler) {
            return;
        }
        await handler(req, res, next);
    };

    await next();
    return res;
}

let salonboardAdminRoutes: any;
let adminJobRoutes: any;
let jobRoutes: any;

afterEach(() => {
    vi.restoreAllMocks();
    writeAuditLog.mockClear();
    createSalonboardService.mockReset();
});

beforeAll(async () => {
    ({ default: salonboardAdminRoutes } = await import('../../src/routes/v1/salonboard.routes.js'));
    ({ default: adminJobRoutes } = await import('../../src/routes/v1/jobs.admin.routes.js'));
    ({ default: jobRoutes } = await import('../../src/routes/v1/jobs.routes.js'));
});

describe('Salonboard routes', () => {
    it('GET /api/v1/admin/integrations/salonboard returns status view', async () => {
        const service = {
            getStatus: vi.fn().mockResolvedValue({
                connected: true,
                isEnabled: true,
                syncDirection: 'both',
                hasCredentials: true,
                lastSyncAt: '2026-03-22T00:00:00.000Z',
                lastSyncStatus: 'success',
            }),
            updateSettings: vi.fn(),
            sync: vi.fn(),
        };
        createSalonboardService.mockReturnValue(service);

        const res = await invokeRoute(salonboardAdminRoutes, 'get', '/');

        expect(res.statusCode).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.connected).toBe(true);
        expect(service.getStatus).toHaveBeenCalledWith();
    });

    it('PUT /api/v1/admin/integrations/salonboard updates settings and audits', async () => {
        const service = {
            getStatus: vi.fn(),
            updateSettings: vi.fn().mockResolvedValue({
                connected: true,
                isEnabled: true,
                syncDirection: 'inbound',
                hasCredentials: true,
                lastSyncAt: undefined,
                lastSyncStatus: undefined,
                lastSyncError: undefined,
            }),
            sync: vi.fn(),
        };
        createSalonboardService.mockReturnValue(service);

        const res = await invokeRoute(salonboardAdminRoutes, 'put', '/', {
            isEnabled: true,
            syncDirection: 'inbound',
            username: 'salon-user',
        });

        expect(res.statusCode).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(service.updateSettings).toHaveBeenCalledWith({
            isEnabled: true,
            syncDirection: 'inbound',
            username: 'salon-user',
        });
        expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'UPDATE',
            entityType: 'salonboard_integration',
        }));
    });

    it('POST /api/v1/admin/jobs/integrations/salonboard/sync triggers manual sync', async () => {
        const service = {
            sync: vi.fn().mockResolvedValue({
                trigger: 'manual',
                fetched: 1,
                created: 1,
                updated: 0,
                conflicts: 0,
                skipped: 0,
                status: 'success',
            }),
            getStatus: vi.fn(),
            updateSettings: vi.fn(),
        };
        createSalonboardService.mockReturnValue(service);

        const res = await invokeRoute(adminJobRoutes, 'post', '/integrations/salonboard/sync');

        expect(res.statusCode).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.stats.status).toBe('success');
        expect(service.sync).toHaveBeenCalledWith('manual');
    });

    it('POST /api/v1/:tenantKey/jobs/integrations/salonboard/sync triggers scheduler sync', async () => {
        const service = {
            sync: vi.fn().mockResolvedValue({
                trigger: 'scheduler',
                fetched: 2,
                created: 0,
                updated: 1,
                conflicts: 1,
                skipped: 0,
                status: 'partial',
            }),
        };
        createSalonboardService.mockReturnValue(service);

        const res = await invokeRoute(jobRoutes, 'post', '/integrations/salonboard/sync', {}, {
            'x-job-secret': 'job-secret',
        });

        expect(res.statusCode).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.stats.status).toBe('partial');
        expect(service.sync).toHaveBeenCalledWith('scheduler');
    });
});
