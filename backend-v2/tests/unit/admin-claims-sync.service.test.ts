import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

let resolveTenantIdForClaimsSync: typeof import('../../src/services/admin-claims-sync.service.js').resolveTenantIdForClaimsSync;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let AuthorizationError: typeof import('../../src/utils/errors.js').AuthorizationError;

function buildClient(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown>): PoolClient {
    return {
        query: vi.fn((sql: string, params?: unknown[]) => queryImpl(sql, params)) as unknown as PoolClient['query'],
    } as unknown as PoolClient;
}

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({ resolveTenantIdForClaimsSync } = await import('../../src/services/admin-claims-sync.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ AuthorizationError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('admin-claims-sync service', () => {
    it('resolves tenantId by firebase_uid inside uid-scoped transaction', async () => {
        const client = buildClient(async (sql, params) => {
            if (sql.includes(`set_config('app.current_firebase_uid'`)) {
                expect(params).toEqual(['firebase-uid-1']);
                return { rows: [{ set_config: 'firebase-uid-1' }] };
            }
            if (sql.includes('SELECT tenant_id') && sql.includes('FROM admins')) {
                expect(params).toEqual(['firebase-uid-1']);
                return { rows: [{ tenant_id: 'tenant-1' }] };
            }
            return { rows: [] };
        });

        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => callback(client));

        await expect(resolveTenantIdForClaimsSync('firebase-uid-1')).resolves.toBe('tenant-1');
    });

    it('throws AuthorizationError when admin is not found', async () => {
        const client = buildClient(async (sql) => {
            if (sql.includes(`set_config('app.current_firebase_uid'`)) {
                return { rows: [{ set_config: 'firebase-uid-missing' }] };
            }
            return { rows: [] };
        });

        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => callback(client));

        await expect(resolveTenantIdForClaimsSync('firebase-uid-missing')).rejects.toBeInstanceOf(AuthorizationError);
    });
});
