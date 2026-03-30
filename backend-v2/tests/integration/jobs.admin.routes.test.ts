import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

const jobsState = vi.hoisted(() => ({
    auth: {
        uid: 'admin-uid',
        role: 'manager',
    },
    tenantId: '11111111-1111-4111-8111-111111111111',
    handleDailyAnalyticsRequest: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (req: any, _res: any, next: any) => {
        req.user = {
            uid: jobsState.auth.uid,
            role: jobsState.auth.role,
        };
        next();
    },
    requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => {
        req.user = req.user ?? {
            uid: jobsState.auth.uid,
            role: jobsState.auth.role,
        };
        if (!roles.includes(req.user.role)) {
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
    getTenantId: () => jobsState.tenantId,
}));

vi.mock('../../src/jobs/reminder.job.js', () => ({
    handleDayBeforeReminderRequest: vi.fn(),
    handleSameDayReminderRequest: vi.fn(),
}));

vi.mock('../../src/jobs/daily-analytics.job.js', () => ({
    handleDailyAnalyticsRequest: jobsState.handleDailyAnalyticsRequest,
}));

vi.mock('../../src/services/google-calendar-sync-queue.service.js', () => ({
    createGoogleCalendarSyncQueueService: vi.fn(),
}));

vi.mock('../../src/services/rfm-thresholds.service.js', () => ({
    recalculateRfmForTenant: vi.fn(),
}));

vi.mock('../../src/services/salonboard.service.js', () => ({
    createSalonboardService: vi.fn(),
}));

let adminJobRoutes: typeof import('../../src/routes/v1/jobs.admin.routes.js').default;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
    ({ default: adminJobRoutes } = await import('../../src/routes/v1/jobs.admin.routes.js'));

    const app = express();
    app.use(express.json());
    app.use('/jobs', adminJobRoutes);
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
    jobsState.handleDailyAnalyticsRequest.mockResolvedValue({
        success: true,
        stats: {
            targetDate: '2026-03-22',
            tenantsProcessed: 1,
            storesProcessed: 2,
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

describe('jobs admin routes integration', () => {
    it('runs the daily analytics job for the authenticated tenant', async () => {
        const { response, json } = await requestJson('/jobs/analytics/daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: '2026-03-22' }),
        });

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.stats.rowsUpserted).toBe(2);
        expect(jobsState.handleDailyAnalyticsRequest).toHaveBeenCalledWith(
            '2026-03-22',
            jobsState.tenantId
        );
    });
});
