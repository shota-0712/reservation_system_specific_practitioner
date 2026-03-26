import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const exportRouteMocks = vi.hoisted(() => ({
    service: {
        create: vi.fn(),
        listWithTotal: vi.fn(),
        findByIdOrFail: vi.fn(),
        getDownload: vi.fn(),
    },
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/middleware/index.js', () => ({
    asyncHandler: (handler: any) => async (req: any, res: any, next: any) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    },
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    validateParams: () => (_req: any, _res: any, next: any) => next(),
    validateQuery: () => (_req: any, _res: any, next: any) => next(),
    idParamSchema: {},
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenantId: () => 'tenant-test',
}));

vi.mock('../../src/services/export-job.service.js', () => ({
    createExportJobService: () => exportRouteMocks.service,
}));

type RouteMethod = 'get' | 'post';

let exportAdminRoutes: any;
const runIntegration = process.env.RUN_INTEGRATION === 'true';
const integrationSuite = runIntegration ? describe : describe.skip;

beforeAll(async () => {
    ({ exportAdminRoutes } = await import('../../src/routes/v1/export.admin.routes.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    exportRouteMocks.service.create.mockReset();
    exportRouteMocks.service.listWithTotal.mockReset();
    exportRouteMocks.service.findByIdOrFail.mockReset();
    exportRouteMocks.service.getDownload.mockReset();
});

function createResponse(): any {
    const headers: Record<string, string> = {};
    return {
        statusCode: 200,
        headers,
        body: undefined as any,
        redirectUrl: undefined as string | undefined,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        setHeader(name: string, value: string) {
            headers[name] = value;
            return this;
        },
        json(payload: any) {
            this.body = payload;
            return this;
        },
        send(payload: any) {
            this.body = payload;
            return this;
        },
        redirect(code: number, url: string) {
            this.statusCode = code;
            this.redirectUrl = url;
            return this;
        },
    };
}

async function invokeRoute(method: RouteMethod, path: string, overrides: Record<string, any> = {}): Promise<any> {
    const layer = exportAdminRoutes.stack.find(
        (entry: any) => entry.route?.path === path && entry.route.methods?.[method]
    );
    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    }

    const handlers = layer.route.stack.map((routeLayer: any) => routeLayer.handle);
    const req: any = {
        method: method.toUpperCase(),
        path,
        headers: {},
        params: {},
        query: {},
        body: {},
        user: { uid: 'uid-test' },
        ...overrides,
    };
    const res = createResponse();

    let index = 0;
    const next = async (error?: unknown): Promise<void> => {
        if (error) throw error;
        const handler = handlers[index++];
        if (!handler) return;
        await handler(req, res, next);
    };

    await next();
    return res;
}

integrationSuite('export admin routes', () => {
    it('creates export jobs and returns a Location header', async () => {
        exportRouteMocks.service.create.mockResolvedValue({
            id: 'job-1',
            tenantId: 'tenant-test',
            exportType: 'operations_reservations',
            format: 'csv',
            params: { dateFrom: '2026-03-01' },
            status: 'queued',
            requestedBy: 'uid-test',
            requestedAt: new Date('2026-03-22T00:00:00.000Z'),
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            updatedAt: new Date('2026-03-22T00:00:00.000Z'),
        });

        const res = await invokeRoute('post', '/', {
            body: {
                exportType: 'operations_reservations',
                format: 'csv',
                params: { dateFrom: '2026-03-01' },
            },
        });

        expect(res.statusCode).toBe(202);
        expect(res.headers.Location).toBe('/api/v1/admin/exports/job-1');
        expect(res.body.success).toBe(true);
        expect(exportRouteMocks.service.create).toHaveBeenCalledWith({
            storeId: undefined,
            exportType: 'operations_reservations',
            format: 'csv',
            params: { dateFrom: '2026-03-01' },
            requestedBy: 'uid-test',
        });
    });

    it('lists export jobs with total metadata', async () => {
        exportRouteMocks.service.listWithTotal.mockResolvedValue({
            jobs: [
                {
                    id: 'job-1',
                    tenantId: 'tenant-test',
                    exportType: 'operations_reservations',
                    format: 'csv',
                    params: {},
                    status: 'completed',
                    requestedAt: new Date('2026-03-22T00:00:00.000Z'),
                    createdAt: new Date('2026-03-22T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-22T00:00:00.000Z'),
                },
            ],
            total: 1,
            page: 1,
            limit: 50,
        });

        const res = await invokeRoute('get', '/');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.meta.total).toBe(1);
        expect(exportRouteMocks.service.listWithTotal).toHaveBeenCalledWith({ page: undefined, limit: undefined });
    });

    it('returns job detail', async () => {
        exportRouteMocks.service.findByIdOrFail.mockResolvedValue({
            id: 'job-1',
            tenantId: 'tenant-test',
            exportType: 'operations_reservations',
            format: 'csv',
            params: {},
            status: 'completed',
            requestedAt: new Date('2026-03-22T00:00:00.000Z'),
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            updatedAt: new Date('2026-03-22T00:00:00.000Z'),
        });

        const res = await invokeRoute('get', '/:id', { params: { id: 'job-1' } });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.id).toBe('job-1');
        expect(exportRouteMocks.service.findByIdOrFail).toHaveBeenCalledWith('job-1');
    });

    it('streams inline downloads directly', async () => {
        exportRouteMocks.service.getDownload.mockResolvedValue({
            filename: 'operations_reservations-job-1.csv',
            contentType: 'text/csv; charset=utf-8',
            content: 'reservationId,customerName\n1,山田',
        });

        const res = await invokeRoute('get', '/:id/download', { params: { id: 'job-1' } });

        expect(res.statusCode).toBe(200);
        expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
        expect(res.headers['Content-Disposition']).toBe('attachment; filename="operations_reservations-job-1.csv"');
        expect(res.body).toContain('reservationId,customerName');
    });

    it('redirects GCS downloads to signed URLs', async () => {
        exportRouteMocks.service.getDownload.mockResolvedValue({
            filename: 'operations_reservations-job-2.csv',
            contentType: 'text/csv; charset=utf-8',
            redirectUrl: 'https://storage.example/export.csv',
        });

        const res = await invokeRoute('get', '/:id/download', { params: { id: 'job-2' } });

        expect(res.statusCode).toBe(302);
        expect(res.redirectUrl).toBe('https://storage.example/export.csv');
    });
});
