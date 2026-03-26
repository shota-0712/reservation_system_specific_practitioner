import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/utils/errors.js';

const assignmentState = vi.hoisted(() => ({
    query: vi.fn(),
    queryOne: vi.fn(),
    transaction: vi.fn(),
    practitionerRepo: {
        findByIdOrFail: vi.fn(),
    },
    menuRepo: {
        findByIdOrFail: vi.fn(),
    },
    optionRepo: {
        findByIdOrFail: vi.fn(),
    },
    user: {
        uid: 'admin-uid',
        role: 'manager',
        permissions: {
            canManagePractitioners: true,
            canManageMenus: true,
            canManageSettings: true,
        },
    },
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: assignmentState.query,
        queryOne: assignmentState.queryOne,
        transaction: assignmentState.transaction,
    },
}));

vi.mock('../../src/repositories/index.js', () => ({
    createPractitionerRepository: () => assignmentState.practitionerRepo,
    createMenuRepository: () => assignmentState.menuRepo,
    createOptionRepository: () => assignmentState.optionRepo,
}));

let assignmentAdminRoutes: typeof import('../../src/routes/v1/assignment.admin.routes.js').assignmentAdminRoutes;
let server: Server;
let baseUrl: string;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PRACTITIONER_ID = '22222222-2222-4222-8222-222222222222';
const MENU_ID = '33333333-3333-4333-8333-333333333333';
const OPTION_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_ID = '55555555-5555-4555-8555-555555555555';
const STORE_ID_A = '66666666-6666-4666-8666-666666666666';
const STORE_ID_B = '77777777-7777-4777-8777-777777777777';

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ assignmentAdminRoutes } = await import('../../src/routes/v1/assignment.admin.routes.js'));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        req.tenantId = TENANT_ID;
        req.user = {
            ...assignmentState.user,
            permissions: { ...assignmentState.user.permissions },
        };
        next();
    });
    app.use('/assignments', assignmentAdminRoutes);
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
    assignmentState.practitionerRepo.findByIdOrFail.mockResolvedValue({ id: PRACTITIONER_ID });
    assignmentState.menuRepo.findByIdOrFail.mockResolvedValue({ id: MENU_ID });
    assignmentState.optionRepo.findByIdOrFail.mockResolvedValue({ id: OPTION_ID });
    assignmentState.queryOne.mockResolvedValue({ id: ADMIN_ID });
    assignmentState.query.mockResolvedValue([]);
    assignmentState.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
        const client = {
            query: vi.fn(async () => ({ rowCount: 1, rows: [] })),
        };
        return callback(client as any);
    });
    assignmentState.user.permissions = {
        canManagePractitioners: true,
        canManageMenus: true,
        canManageSettings: true,
    };
});

afterEach(() => {
    vi.clearAllMocks();
});

async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, init);
    const json = await response.json();
    return { response, json };
}

describe('assignment admin routes', () => {
    it('gets practitioner store assignments', async () => {
        assignmentState.query.mockResolvedValue([{ store_id: STORE_ID_A }, { store_id: STORE_ID_B }] as any);

        const { response, json } = await requestJson(`/assignments/practitioners/${PRACTITIONER_ID}/stores`);

        expect(response.status).toBe(200);
        expect(json.data).toEqual({
            practitionerId: PRACTITIONER_ID,
            storeIds: [STORE_ID_A, STORE_ID_B],
        });
    });

    it('replaces practitioner store assignments', async () => {
        const clientQueries: Array<{ sql: string; params?: unknown[] }> = [];
        assignmentState.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
            const client = {
                query: vi.fn(async (sql: string, params?: unknown[]) => {
                    clientQueries.push({ sql, params });
                    return { rowCount: 1, rows: [] };
                }),
            };
            return callback(client as any);
        });

        const { response, json } = await requestJson(`/assignments/practitioners/${PRACTITIONER_ID}/stores`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [STORE_ID_A, STORE_ID_B] }),
        });

        expect(response.status).toBe(200);
        expect(json.data.storeIds).toEqual([STORE_ID_A, STORE_ID_B]);
        expect(clientQueries[0]?.sql).toContain('DELETE FROM practitioner_store_assignments');
        expect(clientQueries[1]?.sql).toContain('INSERT INTO practitioner_store_assignments');
    });

    it('gets menu practitioner assignments', async () => {
        assignmentState.query.mockResolvedValue([{ practitioner_id: PRACTITIONER_ID }] as any);

        const { response, json } = await requestJson(`/assignments/menus/${MENU_ID}/practitioners`);

        expect(response.status).toBe(200);
        expect(json.data).toEqual({
            menuId: MENU_ID,
            practitionerIds: [PRACTITIONER_ID],
        });
    });

    it('replaces menu practitioner assignments', async () => {
        const clientQueries: Array<{ sql: string; params?: unknown[] }> = [];
        assignmentState.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
            const client = {
                query: vi.fn(async (sql: string, params?: unknown[]) => {
                    clientQueries.push({ sql, params });
                    return { rowCount: 1, rows: [] };
                }),
            };
            return callback(client as any);
        });

        const { response, json } = await requestJson(`/assignments/menus/${MENU_ID}/practitioners`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [PRACTITIONER_ID] }),
        });

        expect(response.status).toBe(200);
        expect(json.data.practitionerIds).toEqual([PRACTITIONER_ID]);
        expect(clientQueries[0]?.sql).toContain('DELETE FROM menu_practitioner_assignments');
        expect(clientQueries[1]?.sql).toContain('INSERT INTO menu_practitioner_assignments');
    });

    it('gets option menu assignments', async () => {
        assignmentState.query.mockResolvedValue([{ menu_id: MENU_ID }] as any);

        const { response, json } = await requestJson(`/assignments/options/${OPTION_ID}/menus`);

        expect(response.status).toBe(200);
        expect(json.data).toEqual({
            optionId: OPTION_ID,
            menuIds: [MENU_ID],
        });
    });

    it('replaces option menu assignments', async () => {
        const clientQueries: Array<{ sql: string; params?: unknown[] }> = [];
        assignmentState.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
            const client = {
                query: vi.fn(async (sql: string, params?: unknown[]) => {
                    clientQueries.push({ sql, params });
                    return { rowCount: 1, rows: [] };
                }),
            };
            return callback(client as any);
        });

        const { response, json } = await requestJson(`/assignments/options/${OPTION_ID}/menus`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [MENU_ID] }),
        });

        expect(response.status).toBe(200);
        expect(json.data.menuIds).toEqual([MENU_ID]);
        expect(clientQueries[0]?.sql).toContain('DELETE FROM option_menu_assignments');
        expect(clientQueries[1]?.sql).toContain('INSERT INTO option_menu_assignments');
    });

    it('gets admin store assignments', async () => {
        assignmentState.query.mockResolvedValue([{ store_id: STORE_ID_A }] as any);

        const { response, json } = await requestJson(`/assignments/admins/${ADMIN_ID}/stores`);

        expect(response.status).toBe(200);
        expect(json.data).toEqual({
            adminId: ADMIN_ID,
            storeIds: [STORE_ID_A],
        });
    });

    it('replaces admin store assignments', async () => {
        const clientQueries: Array<{ sql: string; params?: unknown[] }> = [];
        assignmentState.transaction.mockImplementation(async (callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
            const client = {
                query: vi.fn(async (sql: string, params?: unknown[]) => {
                    clientQueries.push({ sql, params });
                    return { rowCount: 1, rows: [] };
                }),
            };
            return callback(client as any);
        });

        const { response, json } = await requestJson(`/assignments/admins/${ADMIN_ID}/stores`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [STORE_ID_A] }),
        });

        expect(response.status).toBe(200);
        expect(json.data.storeIds).toEqual([STORE_ID_A]);
        expect(clientQueries[0]?.sql).toContain('DELETE FROM admin_store_assignments');
        expect(clientQueries[1]?.sql).toContain('INSERT INTO admin_store_assignments');
    });

    it('returns 404 when practitioner assignments target a missing practitioner', async () => {
        assignmentState.practitionerRepo.findByIdOrFail.mockRejectedValue(
            new NotFoundError('施術者', PRACTITIONER_ID)
        );

        const { response, json } = await requestJson(`/assignments/practitioners/${PRACTITIONER_ID}/stores`);

        expect(response.status).toBe(404);
        expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when admin assignments target a missing admin', async () => {
        assignmentState.queryOne.mockResolvedValue(null);

        const { response, json } = await requestJson(`/assignments/admins/${ADMIN_ID}/stores`);

        expect(response.status).toBe(404);
        expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when practitioner assignment permission is missing', async () => {
        assignmentState.user.permissions.canManagePractitioners = false;

        const { response, json } = await requestJson(`/assignments/practitioners/${PRACTITIONER_ID}/stores`);

        expect(response.status).toBe(403);
        expect(json.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 403 when menu assignment permission is missing', async () => {
        assignmentState.user.permissions.canManageMenus = false;

        const { response, json } = await requestJson(`/assignments/menus/${MENU_ID}/practitioners`);

        expect(response.status).toBe(403);
        expect(json.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 403 when admin assignment permission is missing', async () => {
        assignmentState.user.permissions.canManageSettings = false;

        const { response, json } = await requestJson(`/assignments/admins/${ADMIN_ID}/stores`);

        expect(response.status).toBe(403);
        expect(json.error.code).toBe('AUTHORIZATION_ERROR');
    });
});
