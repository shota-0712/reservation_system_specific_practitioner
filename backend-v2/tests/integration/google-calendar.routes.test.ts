import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const googleCalendarRouteMocks = vi.hoisted(() => ({
    service: {
        getStatus: vi.fn(),
        revoke: vi.fn(),
        buildAuthUrl: vi.fn(),
        exchangeCodeAndSave: vi.fn(),
    },
    queue: {
        getSummary: vi.fn(),
    },
    audit: {
        writeAuditLog: vi.fn().mockResolvedValue(undefined),
        getRequestMeta: vi.fn(() => ({
            ipAddress: '127.0.0.1',
            userAgent: 'vitest',
        })),
    },
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireFirebaseAuth: () => (_req: any, _res: any, next: any) => next(),
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
}));

vi.mock('../../src/middleware/tenant.js', () => ({
    getTenantId: () => 'tenant-test',
}));

vi.mock('../../src/services/google-calendar.service.js', () => ({
    createGoogleCalendarService: () => googleCalendarRouteMocks.service,
}));

vi.mock('../../src/services/google-calendar-sync-queue.service.js', () => ({
    createGoogleCalendarSyncQueueService: () => googleCalendarRouteMocks.queue,
}));

vi.mock('../../src/services/audit-log.service.js', () => googleCalendarRouteMocks.audit);

let googleCalendarAdminRoutes: any;
let googleCalendarCallbackRoutes: any;
let encodeGoogleOAuthState: typeof import('../../src/services/google-oauth-state.service.js').encodeGoogleOAuthState;
let decodeGoogleOAuthState: typeof import('../../src/services/google-oauth-state.service.js').decodeGoogleOAuthState;
const runIntegration = process.env.RUN_INTEGRATION === 'true';
const integrationSuite = runIntegration ? describe : describe.skip;

beforeAll(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

    const routesModule = await import('../../src/routes/v1/google-calendar.routes.js');
    const stateModule = await import('../../src/services/google-oauth-state.service.js');

    googleCalendarAdminRoutes = routesModule.googleCalendarAdminRoutes;
    googleCalendarCallbackRoutes = routesModule.googleCalendarCallbackRoutes;
    encodeGoogleOAuthState = stateModule.encodeGoogleOAuthState;
    decodeGoogleOAuthState = stateModule.decodeGoogleOAuthState;
});

afterEach(() => {
    vi.restoreAllMocks();
    googleCalendarRouteMocks.service.getStatus.mockReset();
    googleCalendarRouteMocks.service.revoke.mockReset();
    googleCalendarRouteMocks.service.buildAuthUrl.mockReset();
    googleCalendarRouteMocks.service.exchangeCodeAndSave.mockReset();
    googleCalendarRouteMocks.queue.getSummary.mockReset();
    googleCalendarRouteMocks.audit.writeAuditLog.mockClear();
    googleCalendarRouteMocks.audit.getRequestMeta.mockClear();
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
        type() {
            return this;
        },
        redirect(code: number, url: string) {
            this.statusCode = code;
            this.redirectUrl = url;
            return this;
        },
        accepts() {
            return false;
        },
    };
}

async function invokeRoute(method: 'get' | 'put' | 'post', path: string, overrides: Record<string, any> = {}): Promise<any> {
    const layer = googleCalendarAdminRoutes.stack.find(
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
        user: { uid: 'uid-test', name: 'テスト管理者' },
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

async function invokeCallback(path: string, overrides: Record<string, any> = {}): Promise<any> {
    const layer = googleCalendarCallbackRoutes.stack.find(
        (entry: any) => entry.route?.path === path && entry.route.methods?.get
    );
    if (!layer) {
        throw new Error(`Route not found: GET ${path}`);
    }

    const handlers = layer.route.stack.map((routeLayer: any) => routeLayer.handle);
    const req: any = {
        method: 'GET',
        path,
        headers: {},
        params: {},
        query: {},
        body: {},
        accepts: () => false,
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

integrationSuite('google calendar routes', () => {
    it('returns queue summary and OAuth status from the admin endpoint', async () => {
        googleCalendarRouteMocks.service.getStatus.mockResolvedValue({
            connected: true,
            status: 'active',
            email: 'owner@example.com',
            scope: 'openid email profile',
            updatedAt: '2026-03-22T00:00:00.000Z',
        });
        googleCalendarRouteMocks.queue.getSummary.mockResolvedValue({
            pending: 1,
            running: 0,
            failed: 0,
            dead: 0,
        });

        const res = await invokeRoute('get', '/');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.queue.pending).toBe(1);
        expect(googleCalendarRouteMocks.service.getStatus).toHaveBeenCalledWith();
        expect(googleCalendarRouteMocks.queue.getSummary).toHaveBeenCalledWith();
    });

    it('revokes the integration and writes an audit log', async () => {
        googleCalendarRouteMocks.service.getStatus.mockResolvedValue({
            connected: false,
            status: 'revoked',
        });

        const res = await invokeRoute('put', '/', { body: { status: 'revoked' } });

        expect(res.statusCode).toBe(200);
        expect(googleCalendarRouteMocks.service.revoke).toHaveBeenCalledWith();
        expect(googleCalendarRouteMocks.audit.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-test',
                entityType: 'google_calendar_integration',
                actorType: 'admin',
            })
        );
    });

    it('builds the OAuth start URL with encoded tenant state', async () => {
        googleCalendarRouteMocks.service.buildAuthUrl.mockImplementation((state: string) => `https://accounts.example/auth?state=${state}`);

        const res = await invokeRoute('post', '/oauth/start', {
            body: {
                redirectTo: 'https://example.com/settings',
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body.data.authUrl).toContain('https://accounts.example/auth?state=');
        const state = googleCalendarRouteMocks.service.buildAuthUrl.mock.calls[0]?.[0] as string;
        expect(googleCalendarRouteMocks.service.buildAuthUrl).toHaveBeenCalledWith(expect.any(String));
        expect(state).toBeTruthy();
        expect(decodeGoogleOAuthState(state)).toEqual(
            expect.objectContaining({
                tenantId: 'tenant-test',
                redirectTo: 'https://example.com/settings',
            })
        );
    });

    it('redirects callback completions back to the requested URL', async () => {
        googleCalendarRouteMocks.service.exchangeCodeAndSave.mockResolvedValue({
            connected: true,
            status: 'active',
            email: 'owner@example.com',
            scope: 'openid email profile',
        });

        const state = encodeGoogleOAuthState({
            tenantId: 'tenant-test',
            issuedAt: Date.now(),
            redirectTo: 'https://example.com/settings',
        });

        const res = await invokeCallback('/oauth/callback', {
            query: {
                code: 'auth-code-1',
                state,
            },
        });

        expect(res.statusCode).toBe(302);
        expect(res.redirectUrl).toContain('https://example.com/settings');
        expect(res.redirectUrl).toContain('googleCalendar=connected');
        expect(googleCalendarRouteMocks.service.exchangeCodeAndSave).toHaveBeenCalledWith('auth-code-1');
        expect(googleCalendarRouteMocks.audit.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-test',
                entityType: 'google_calendar_integration',
                actorType: 'system',
            })
        );
    });
});
