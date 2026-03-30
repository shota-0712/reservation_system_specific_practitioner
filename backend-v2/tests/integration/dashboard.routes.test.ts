import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const dashboardState = vi.hoisted(() => ({
    auth: {
        uid: 'admin-uid',
        role: 'manager',
    },
    tenantId: '11111111-1111-4111-8111-111111111111',
    queryOne: vi.fn(),
    query: vi.fn(),
    getDashboardActivity: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (req: any, _res: any, next: any) => {
        req.user = {
            uid: dashboardState.auth.uid,
            role: dashboardState.auth.role,
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
    getTenantId: () => dashboardState.tenantId,
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        queryOne: dashboardState.queryOne,
        query: dashboardState.query,
    },
}));

vi.mock('../../src/repositories/index.js', () => ({
    createReservationRepository: vi.fn(),
    createPractitionerRepository: vi.fn(),
}));

vi.mock('../../src/services/dashboard-activity.service.js', () => ({
    getDashboardActivity: dashboardState.getDashboardActivity,
}));

let dashboardRoutes: typeof import('../../src/routes/v1/dashboard.routes.js').default;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
    ({ default: dashboardRoutes } = await import('../../src/routes/v1/dashboard.routes.js'));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
        req.user = {
            uid: dashboardState.auth.uid,
            role: dashboardState.auth.role,
        };
        next();
    });
    app.use('/dashboard', dashboardRoutes);
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
    dashboardState.query.mockResolvedValue([]);
    dashboardState.getDashboardActivity.mockResolvedValue([
        {
            action: 'UPDATE',
            entityType: 'settings',
            entityId: 'settings-1',
            actorType: 'admin',
            actorId: 'admin-uid',
            actorName: 'Owner Admin',
            createdAt: '2026-03-22T00:00:00.000Z',
        },
    ]);
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('dashboard routes integration', () => {
    it('returns KPI values from daily_analytics when rows are available', async () => {
        dashboardState.queryOne
            .mockResolvedValueOnce({
                row_count: '2',
                revenue: '12000',
                bookings: '4',
                completed_count: '3',
                new_customers: '2',
            })
            .mockResolvedValueOnce({
                row_count: '2',
                revenue: '6000',
                bookings: '2',
                completed_count: '2',
                new_customers: '1',
            });

        const { response, json } = await requestJson('/dashboard/kpi');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.revenue.value).toBe(12000);
        expect(json.data.bookings.value).toBe(4);
        expect(json.data.newCustomers.value).toBe(2);
        expect(json.data.avgSpend.value).toBe(4000);
        expect(dashboardState.queryOne).toHaveBeenCalledTimes(2);
    });

    it('returns dashboard activity items', async () => {
        const { response, json } = await requestJson('/dashboard/activity?limit=5');

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toEqual([
            {
                action: 'UPDATE',
                entityType: 'settings',
                entityId: 'settings-1',
                actorType: 'admin',
                actorId: 'admin-uid',
                actorName: 'Owner Admin',
                createdAt: '2026-03-22T00:00:00.000Z',
            },
        ]);
        expect(dashboardState.getDashboardActivity).toHaveBeenCalledWith(
            dashboardState.tenantId,
            5
        );
    });
});
