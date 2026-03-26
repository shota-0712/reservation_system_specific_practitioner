import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        queryOne: queryOneMock,
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        warn: loggerWarnMock,
        debug: vi.fn(),
    },
}));

let resolveTenant: typeof import('../../src/middleware/tenant.js').resolveTenant;
let clearTenantCache: typeof import('../../src/middleware/tenant.js').clearTenantCache;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID  = '22222222-2222-4222-8222-222222222222';
const STORE_CODE = 'abc12345';

function makeTenantRow(overrides: Record<string, unknown> = {}) {
    return {
        id: TENANT_ID,
        slug: 'default',
        name: 'Default Salon',
        plan: 'trial',
        status: 'active',
        onboarding_status: null,
        onboarding_completed_at: null,
        onboarding_payload: null,
        line_mode: 'tenant',
        line_channel_id: null,
        line_channel_secret_encrypted: null,
        line_channel_access_token_encrypted: null,
        line_liff_id: null,
        branding_primary_color: '#4F46E5',
        branding_logo_url: null,
        branding_favicon_url: null,
        stripe_customer_id: null,
        subscription_current_period_end: null,
        max_stores: 1,
        max_practitioners: 5,
        created_at: new Date(),
        updated_at: new Date(),
        ...overrides,
    };
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({ resolveTenant, clearTenantCache } = await import('../../src/middleware/tenant.js'));
});

beforeEach(() => {
    vi.clearAllMocks();
    clearTenantCache();
});

describe('resolveTenant — store_code path (resolve_active_store_context)', () => {
    it('resolves tenant via resolve_active_store_context and sets storeId', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('resolve_active_store_context')) {
                return { tenant_id: TENANT_ID, store_id: STORE_ID };
            }
            if (sql.includes('FROM tenants WHERE id = $1')) {
                return makeTenantRow();
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: STORE_CODE }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        expect(req.storeId).toBe(STORE_ID);
        expect(loggerWarnMock).not.toHaveBeenCalled();
    });

    it('falls back to slug lookup when resolve_active_store_context returns null (no match)', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('resolve_active_store_context')) {
                return null;
            }
            if (sql.includes('FROM tenants WHERE slug = $1')) {
                return makeTenantRow();
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: 'default' }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        expect(req.storeId).toBeUndefined();
    });

    it('falls back to slug lookup when resolve_active_store_context raises recoverable DB error', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('resolve_active_store_context')) {
                throw { code: '22P02', message: 'invalid input syntax for type uuid: ""' };
            }
            if (sql.includes('FROM tenants WHERE slug = $1')) {
                return makeTenantRow({ slug: STORE_CODE });
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: STORE_CODE }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    it('propagates non-recoverable error from resolve_active_store_context', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('resolve_active_store_context')) {
                throw { code: '53300', message: 'too many connections' };
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: STORE_CODE }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        // Error must be passed to next() (not swallowed)
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: '53300' }));
    });

    it('Fail-fast: propagates 42883 (undefined_function) when resolve_active_store_context is not installed', async () => {
        // 42883 = undefined_function: means the DB function was never applied.
        // Per Fail-fast policy this MUST propagate rather than fall back to slug,
        // so that missing migration is detected immediately in production.
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('resolve_active_store_context')) {
                throw { code: '42883', message: 'function resolve_active_store_context(text) does not exist' };
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: STORE_CODE }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: '42883' }));
        // Must NOT have fallen back silently
        expect(loggerWarnMock).not.toHaveBeenCalled();
    });
});

describe('resolveTenant — slug path', () => {
    it('resolves tenant by slug without calling resolve_active_store_context', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM tenants WHERE slug = $1')) return makeTenantRow();
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: 'default' }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        const storeFuncCalls = queryOneMock.mock.calls.filter((args: unknown[]) =>
            typeof args[0] === 'string' && args[0].includes('resolve_active_store_context')
        );
        expect(storeFuncCalls).toHaveLength(0);
    });

    it('bypasses store-code lookup for hyphenated auth/config tenant slugs', async () => {
        queryOneMock.mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes('FROM tenants WHERE slug = $1')) {
                expect(params).toEqual(['smoke-salon-1773680978']);
                return makeTenantRow({ slug: 'smoke-salon-1773680978' });
            }
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = {
            params: { tenantKey: 'smoke-salon-1773680978' },
            headers: {},
            query: {},
            path: '/auth/config',
        };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        const storeFuncCalls = queryOneMock.mock.calls.filter((args: unknown[]) =>
            typeof args[0] === 'string' && args[0].includes('resolve_active_store_context')
        );
        expect(storeFuncCalls).toHaveLength(0);
    });
});

describe('resolveTenant — UUID path', () => {
    it('resolves tenant by UUID directly without calling resolve_active_store_context', async () => {
        queryOneMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM tenants WHERE id = $1')) return makeTenantRow();
            return null;
        });

        const middleware = resolveTenant({ required: true });
        const req: any = { params: { tenantKey: TENANT_ID }, headers: {}, query: {} };
        const res: any = {};
        const next = vi.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.tenantId).toBe(TENANT_ID);
        // Should not have called the store-code function for a UUID key
        const storeFuncCalls = queryOneMock.mock.calls.filter((args: unknown[]) =>
            typeof args[0] === 'string' && args[0].includes('resolve_active_store_context')
        );
        expect(storeFuncCalls).toHaveLength(0);
    });
});
