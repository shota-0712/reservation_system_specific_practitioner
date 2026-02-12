import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

let createOnboardingService: typeof import('../../src/services/onboarding.service.js').createOnboardingService;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let ConflictError: typeof import('../../src/utils/errors.js').ConflictError;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const module = await import('../../src/services/onboarding.service.js');
    createOnboardingService = module.createOnboardingService;
    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ ConflictError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

function buildClient(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown>): PoolClient {
    return {
        query: vi.fn((sql: string, params?: unknown[]) => queryImpl(sql, params)) as unknown as PoolClient['query'],
    } as unknown as PoolClient;
}

const baseInput = {
    firebaseUid: 'uid-1',
    email: 'owner@example.com',
    ownerName: 'Owner',
    tenantName: 'Salon One',
    storeName: 'Salon One 本店',
    timezone: 'Asia/Tokyo',
};

describe('onboarding-service', () => {
    it('auto-generates next slug when base slug already exists', async () => {
        const slugChecks: string[] = [];

        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql, params) => {
                if (sql.includes('SELECT id FROM tenants WHERE slug')) {
                    slugChecks.push(String(params?.[0] ?? ''));
                    if (slugChecks.length === 1) {
                        return { rowCount: 1, rows: [{ id: 'existing' }] };
                    }
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('SELECT id FROM admins WHERE firebase_uid')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO tenants')) {
                    return { rowCount: 1, rows: [{ id: 'tenant-1', slug: params?.[0] }] };
                }
                if (sql.includes('SELECT set_tenant')) {
                    return { rowCount: 1, rows: [] };
                }
                if (sql.includes('SELECT id FROM stores WHERE store_code')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO stores')) {
                    return { rowCount: 1, rows: [{ id: 'store-1' }] };
                }
                if (sql.includes('INSERT INTO admins')) {
                    return { rowCount: 1, rows: [{ id: 'admin-1' }] };
                }
                return { rowCount: 0, rows: [] };
            });
            return callback(client);
        });

        const service = createOnboardingService();
        await expect(service.register(baseInput)).resolves.toEqual({
            tenantId: 'tenant-1',
            tenantSlug: 'salon-one-1',
            storeId: 'store-1',
            adminId: 'admin-1',
        });
        expect(slugChecks).toEqual(['salon-one', 'salon-one-1']);
    });

    it('throws conflict when firebase uid is already initialized', async () => {
        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql) => {
                if (sql.includes('SELECT id FROM tenants WHERE slug')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('SELECT id FROM admins WHERE firebase_uid')) {
                    return { rowCount: 1, rows: [{ id: 'admin-1' }] };
                }
                return { rowCount: 0, rows: [] };
            });
            return callback(client);
        });

        const service = createOnboardingService();
        await expect(service.register(baseInput)).rejects.toBeInstanceOf(ConflictError);
    });

    it('creates tenant/store/admin in one transaction', async () => {
        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql, params) => {
                if (sql.includes('SELECT id FROM tenants WHERE slug')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('SELECT id FROM admins WHERE firebase_uid')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO tenants')) {
                    return { rowCount: 1, rows: [{ id: 'tenant-1', slug: params?.[0] }] };
                }
                if (sql.includes('SELECT set_tenant')) {
                    return { rowCount: 1, rows: [] };
                }
                if (sql.includes('SELECT id FROM stores WHERE store_code')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO stores')) {
                    return { rowCount: 1, rows: [{ id: 'store-1' }] };
                }
                if (sql.includes('INSERT INTO admins')) {
                    return { rowCount: 1, rows: [{ id: 'admin-1' }] };
                }
                return { rowCount: 0, rows: [] };
            });
            return callback(client);
        });

        const service = createOnboardingService();
        await expect(service.register(baseInput)).resolves.toEqual({
            tenantId: 'tenant-1',
            tenantSlug: 'salon-one',
            storeId: 'store-1',
            adminId: 'admin-1',
        });
    });

    it('propagates failure from transaction callback', async () => {
        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql) => {
                if (sql.includes('SELECT id FROM tenants WHERE slug')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('SELECT id FROM admins WHERE firebase_uid')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO tenants')) {
                    return { rowCount: 1, rows: [{ id: 'tenant-1', slug: 'salon-one' }] };
                }
                if (sql.includes('SELECT set_tenant')) {
                    return { rowCount: 1, rows: [] };
                }
                if (sql.includes('SELECT id FROM stores WHERE store_code')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO stores')) {
                    throw new Error('db failure');
                }
                return { rowCount: 0, rows: [] };
            });
            return callback(client);
        });

        const service = createOnboardingService();
        await expect(service.register(baseInput)).rejects.toThrowError('db failure');
    });
});
