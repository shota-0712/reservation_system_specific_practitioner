import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
    process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
}

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (_req: any, _res: any, next: any) => next(),
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenant: () => ({ id: 'tenant-test' }),
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

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type InvokeResult = {
    status: number;
    json: Record<string, any>;
};

let reportsRoutes: any;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

const runIntegration = process.env.RUN_INTEGRATION === 'true';
const integrationSuite = runIntegration ? describe : describe.skip;

async function invokeRoute(
    method: RouteMethod,
    path: string,
    query: Record<string, string> = {}
): Promise<InvokeResult> {
    const layer = reportsRoutes.stack.find(
        (entry: any) => entry.route?.path === path && entry.route.methods?.[method]
    );

    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    }

    const handlers = layer.route.stack.map((routeLayer: any) => routeLayer.handle);

    const req: any = {
        method: method.toUpperCase(),
        path,
        query,
        params: {},
        headers: {},
        body: {},
    };

    const res: any = {
        statusCode: 200,
        payload: {},
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: Record<string, any>) {
            this.payload = payload;
            return this;
        },
    };

    let index = 0;
    const runHandler = async (error?: unknown): Promise<void> => {
        if (error) {
            throw error;
        }
        const handler = handlers[index++];
        if (!handler) {
            return;
        }
        await handler(req, res, runHandler);
    };

    await runHandler();

    return {
        status: res.statusCode,
        json: res.payload,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

integrationSuite('reports routes integration', () => {
    beforeAll(async () => {
        const [{ default: routes }, dbModule] = await Promise.all([
            import('../../src/routes/v1/reports.routes.js'),
            import('../../src/config/database.js'),
        ]);

        reportsRoutes = routes;
        DatabaseService = dbModule.DatabaseService;
    });

    it('returns summary using daily_analytics aggregates when available', async () => {
        vi.spyOn(DatabaseService, 'queryOne')
            .mockResolvedValueOnce({
                row_count: '30',
                revenue: '100000',
                bookings: '80',
                completed_count: '40',
                unique_customers: '50',
                new_customers: '10',
            } as any)
            .mockResolvedValueOnce({
                row_count: '30',
                revenue: '80000',
                bookings: '70',
                completed_count: '35',
                unique_customers: '45',
                new_customers: '8',
            } as any);

        const { status, json } = await invokeRoute('get', '/summary', { period: 'month' });

        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data.revenue.value).toBe(100000);
        expect(json.data.bookings.value).toBe(80);
        expect(json.data.avgSpend.value).toBe(2500);
        expect(json.data.repeatRate.value).toBe(80);
    });

    it('falls back to reservations for menu-ranking when daily_analytics is empty', async () => {
        vi.spyOn(DatabaseService, 'query')
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                { name: 'カット', count: '5', revenue: '25000' },
            ] as any);

        const { status, json } = await invokeRoute('get', '/menu-ranking');

        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toEqual([
            { name: 'カット', count: 5, revenue: 25000 },
        ]);
    });

    it('falls back to reservations for practitioner-revenue when daily_analytics query fails', async () => {
        vi.spyOn(DatabaseService, 'query')
            .mockRejectedValueOnce(new Error('column does not exist'))
            .mockResolvedValueOnce([
                { name: '佐藤', revenue: '40000', customers: '6' },
            ] as any);

        const { status, json } = await invokeRoute('get', '/practitioner-revenue');

        expect(status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toEqual([
            { name: '佐藤', revenue: 40000, customers: 6 },
        ]);
    });
});
