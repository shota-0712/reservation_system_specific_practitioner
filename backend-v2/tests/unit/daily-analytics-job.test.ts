import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: analyticsMocks.query,
        queryOne: analyticsMocks.queryOne,
        transaction: analyticsMocks.transaction,
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: analyticsMocks.loggerInfo,
        error: analyticsMocks.loggerError,
    },
}));

let resolveDailyAnalyticsTargetDate: typeof import('../../src/jobs/daily-analytics.job.js').resolveDailyAnalyticsTargetDate;
let runDailyAnalytics: typeof import('../../src/jobs/daily-analytics.job.js').runDailyAnalytics;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    const module = await import('../../src/jobs/daily-analytics.job.js');
    resolveDailyAnalyticsTargetDate = module.resolveDailyAnalyticsTargetDate;
    runDailyAnalytics = module.runDailyAnalytics;
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('daily-analytics-job', () => {
    it('returns explicit date when valid format is provided', () => {
        expect(resolveDailyAnalyticsTargetDate('2026-02-08')).toBe('2026-02-08');
    });

    it('throws validation error when date format is invalid', () => {
        expect(() => resolveDailyAnalyticsTargetDate('2026/02/08')).toThrowError(
            'date must be YYYY-MM-DD format'
        );
    });

    it('returns YYYY-MM-DD for default target date', () => {
        expect(resolveDailyAnalyticsTargetDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('fans out per tenant and store, zero-fills empty stores, and upserts daily rows', async () => {
        const capturedWrites: Array<{ tenantId: string; params: unknown[]; sql: string }> = [];

        analyticsMocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes("FROM tenants") && sql.includes("status IN ('active', 'trial')")) {
                return [
                    { id: 'tenant-1' },
                    { id: 'tenant-2' },
                ];
            }

            if (sql.includes('FROM stores')) {
                if (params?.[0] === 'tenant-1') {
                    return [
                        { id: '11111111-1111-4111-8111-111111111111' },
                        { id: '22222222-2222-4222-8222-222222222222' },
                    ];
                }
                if (params?.[0] === 'tenant-2') {
                    return [
                        { id: '33333333-3333-4333-8333-333333333333' },
                    ];
                }
            }

            if (sql.includes('WITH reservation_source')) {
                if (params?.[0] === 'tenant-1') {
                    return [
                        {
                            store_id: '11111111-1111-4111-8111-111111111111',
                            total_revenue: '12000',
                            reservation_count: '3',
                            completed_count: '2',
                            canceled_count: '1',
                            no_show_count: '0',
                            new_customers: '1',
                            returning_customers: '1',
                            unique_customers: '2',
                            average_order_value: '6000',
                            revenue_by_practitioner: { 佐藤: 12000 },
                            revenue_by_menu: { カット: 12000 },
                            reservations_count_by_menu: { カット: 2 },
                            unique_customers_by_practitioner: { 佐藤: 2 },
                            reservations_by_hour: { '10': 2, '11': 1 },
                        },
                    ];
                }
                if (params?.[0] === 'tenant-2') {
                    return [];
                }
            }

            return [];
        });

        analyticsMocks.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>, tenantId?: string) => {
            const client = {
                query: vi.fn(async (sql: string, params?: unknown[]) => {
                    capturedWrites.push({
                        tenantId: tenantId ?? 'unknown',
                        sql,
                        params: params ?? [],
                    });
                    return { rowCount: 1, rows: [] };
                }),
            };
            return callback(client as any);
        });

        const stats = await runDailyAnalytics('2026-03-21');

        expect(stats).toEqual({
            targetDate: '2026-03-21',
            tenantsProcessed: 2,
            storesProcessed: 3,
            rowsUpserted: 3,
            failedTenants: 0,
        });

        expect(capturedWrites).toHaveLength(3);
        expect(capturedWrites.every((write) => write.sql.includes('ON CONFLICT (tenant_id, store_id, date)'))).toBe(true);

        expect(capturedWrites).toContainEqual(expect.objectContaining({
            tenantId: 'tenant-1',
            params: [
                'tenant-1',
                '11111111-1111-4111-8111-111111111111',
                '2026-03-21',
                12000,
                3,
                2,
                1,
                0,
                1,
                1,
                2,
                6000,
                { 佐藤: 12000 },
                { カット: 12000 },
                { カット: 2 },
                { 佐藤: 2 },
                { '10': 2, '11': 1 },
            ],
        }));

        expect(capturedWrites).toContainEqual(expect.objectContaining({
            tenantId: 'tenant-1',
            params: [
                'tenant-1',
                '22222222-2222-4222-8222-222222222222',
                '2026-03-21',
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                {},
                {},
                {},
                {},
                {},
            ],
        }));

        expect(capturedWrites).toContainEqual(expect.objectContaining({
            tenantId: 'tenant-2',
            params: [
                'tenant-2',
                '33333333-3333-4333-8333-333333333333',
                '2026-03-21',
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                {},
                {},
                {},
                {},
                {},
            ],
        }));
    });
});
