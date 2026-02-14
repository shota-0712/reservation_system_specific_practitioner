import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdTokenMock = vi.fn();
const queryOneMock = vi.fn();
const queryMock = vi.fn();

vi.mock('../../src/config/firebase.js', () => ({
    getAuthInstance: () => ({
        verifyIdToken: verifyIdTokenMock,
    }),
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        queryOne: queryOneMock,
        query: queryMock,
    },
}));

let requireFirebaseAuth: typeof import('../../src/middleware/auth.js').requireFirebaseAuth;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({ requireFirebaseAuth } = await import('../../src/middleware/auth.js'));
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('requireFirebaseAuth middleware', () => {
    it('rejects requests for stores outside admin scope', async () => {
        verifyIdTokenMock.mockResolvedValue({ uid: 'uid-1', email: 'owner@example.com' });
        queryOneMock.mockResolvedValue({
            id: 'admin-1',
            tenant_id: 'tenant-1',
            firebase_uid: 'uid-1',
            role: 'manager',
            permissions: {},
            store_ids: ['store-allowed'],
            is_active: true,
        });
        queryMock.mockResolvedValue([{ id: 'store-allowed' }]);

        const req: any = {
            headers: {
                authorization: 'Bearer token',
                'x-store-id': 'store-denied',
            },
            tenantId: 'tenant-1',
            storeId: 'store-denied',
        };
        const res: any = {};
        const next = vi.fn();

        await requireFirebaseAuth()(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0]?.[0] as { statusCode?: number; code?: string; message?: string };
        expect(error?.statusCode).toBe(403);
        expect(error?.code).toBe('AUTHORIZATION_ERROR');
    });

    it('applies first allowed store when request does not specify store', async () => {
        verifyIdTokenMock.mockResolvedValue({ uid: 'uid-2', email: 'manager@example.com' });
        queryOneMock.mockResolvedValue({
            id: 'admin-2',
            tenant_id: 'tenant-1',
            firebase_uid: 'uid-2',
            role: 'manager',
            permissions: {},
            store_ids: ['store-1', 'store-2'],
            is_active: true,
        });
        queryMock.mockResolvedValue([{ id: 'store-1' }, { id: 'store-2' }]);

        const req: any = {
            headers: {
                authorization: 'Bearer token',
            },
            tenantId: 'tenant-1',
        };
        const res: any = {};
        const next = vi.fn();

        await requireFirebaseAuth()(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.storeId).toBe('store-1');
        expect(req.user?.storeIds).toEqual(['store-1', 'store-2']);
    });

    it('falls back to active tenant stores when admin scope is empty', async () => {
        verifyIdTokenMock.mockResolvedValue({ uid: 'uid-3', email: 'admin@example.com' });
        queryOneMock.mockResolvedValue({
            id: 'admin-3',
            tenant_id: 'tenant-1',
            firebase_uid: 'uid-3',
            role: 'admin',
            permissions: {},
            store_ids: [],
            is_active: true,
        });
        queryMock.mockResolvedValue([
            { id: 'store-a' },
            { id: 'store-b' },
        ]);

        const req: any = {
            headers: {
                authorization: 'Bearer token',
            },
            tenantId: 'tenant-1',
        };
        const res: any = {};
        const next = vi.fn();

        await requireFirebaseAuth()(req, res, next);

        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(req.storeId).toBe('store-a');
        expect(req.user?.storeIds).toEqual(['store-a', 'store-b']);
        expect(next).toHaveBeenCalledWith();
    });
});
