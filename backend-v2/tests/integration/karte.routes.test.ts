import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    authContext: {
        tenantId: 'tenant-1',
        user: {
            uid: 'admin-1',
            tenantId: 'tenant-1',
            role: 'owner',
            permissions: {
                canManageReservations: true,
                canManageCustomers: true,
                canManageMenus: true,
                canManagePractitioners: true,
                canManageSettings: true,
                canViewReports: true,
                canManageAdmins: true,
            },
            name: 'Owner Admin',
        },
    },
}));

const auditLogState = vi.hoisted(() => ({
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    getRequestMeta: vi.fn(() => ({
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest',
    })),
}));

const repositoryState = vi.hoisted(() => ({
    createKarteRepository: vi.fn(),
    createKarteTemplateRepository: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', async () => {
    const actual = await vi.importActual<typeof import('../../src/middleware/auth.js')>('../../src/middleware/auth.js');

    return {
        ...actual,
        requireFirebaseAuth: () => (req: any, _res: any, next: any) => {
            req.tenantId = testState.authContext.tenantId;
            req.user = { ...testState.authContext.user };
            next();
        },
    };
});

vi.mock('../../src/repositories/index.js', () => repositoryState);

vi.mock('../../src/services/audit-log.service.js', () => auditLogState);

vi.mock('../../src/middleware/error-handler.js', () => ({
    asyncHandler: (handler: any) => async (req: any, res: any, next: any) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    },
}));

let karteAdminRoutes: typeof import('../../src/routes/v1/karte.admin.routes.js').karteAdminRoutes;
let karteTemplateAdminRoutes: typeof import('../../src/routes/v1/karte-template.admin.routes.js').karteTemplateAdminRoutes;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ karteAdminRoutes } = await import('../../src/routes/v1/karte.admin.routes.js'));
    ({ karteTemplateAdminRoutes } = await import('../../src/routes/v1/karte-template.admin.routes.js'));
});

afterEach(() => {
    vi.clearAllMocks();
    testState.authContext = {
        tenantId: 'tenant-1',
        user: {
            uid: 'admin-1',
            tenantId: 'tenant-1',
            role: 'owner',
            permissions: {
                canManageReservations: true,
                canManageCustomers: true,
                canManageMenus: true,
                canManagePractitioners: true,
                canManageSettings: true,
                canViewReports: true,
                canManageAdmins: true,
            },
            name: 'Owner Admin',
        },
    };
});

type RouteMethod = 'get' | 'post' | 'put' | 'delete';

type InvokeOutcome = {
    status: number;
    json: Record<string, any>;
    headers: Record<string, string>;
    error?: unknown;
};

function createResponse() {
    return {
        statusCode: 200,
        payload: {} as Record<string, any>,
        headers: {} as Record<string, string>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: Record<string, any>) {
            this.payload = payload;
            return this;
        },
        setHeader(name: string, value: string) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
    };
}

async function invokeRoute(
    router: any,
    method: RouteMethod,
    path: string,
    options: {
        query?: Record<string, string>;
        params?: Record<string, string>;
        body?: Record<string, any>;
        headers?: Record<string, string>;
        ip?: string;
    } = {}
): Promise<InvokeOutcome> {
    const layer = router.stack.find(
        (entry: any) => entry.route?.path === path && entry.route.methods?.[method]
    );

    if (!layer) {
        throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    }

    const handlers = layer.route.stack.map((routeLayer: any) => routeLayer.handle);
    const req: any = {
        method: method.toUpperCase(),
        path,
        tenantId: testState.authContext.tenantId,
        query: { ...(options.query ?? {}) },
        params: { ...(options.params ?? {}) },
        body: { ...(options.body ?? {}) },
        headers: { ...(options.headers ?? {}) },
        ip: options.ip,
        user: { ...testState.authContext.user },
    };
    const res = createResponse();
    let index = 0;
    let error: unknown;

    const next = async (nextError?: unknown): Promise<void> => {
        if (nextError) {
            error = nextError;
            return;
        }

        const handler = handlers[index++];
        if (!handler) {
            return;
        }

        await handler(req, res, next);
    };

    await next();

    return {
        status: res.statusCode,
        json: res.payload,
        headers: res.headers,
        error,
    };
}

describe('karte admin routes', () => {
    it('lists kartes with the default limit', async () => {
        const repo = {
            findAll: vi.fn().mockResolvedValue([
                {
                    id: 'karte-1',
                    tenantId: 'tenant-1',
                    customerId: 'customer-1',
                    practitionerId: 'practitioner-1',
                    visitDate: '2026-03-17',
                    menuIds: [],
                    menuNames: [],
                    optionIds: [],
                    productsUsed: [],
                    customFields: {},
                    photosBefore: [],
                    photosAfter: [],
                    photosOther: [],
                    status: 'draft',
                    tags: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'get', '/');

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(200);
        expect(result.json.success).toBe(true);
        expect(result.json.data[0].id).toBe('karte-1');
        expect(repositoryState.createKarteRepository).toHaveBeenCalledWith('tenant-1');
        expect(repo.findAll).toHaveBeenCalledWith(100);
    });

    it('rejects requests without canManageCustomers permission', async () => {
        testState.authContext = {
            tenantId: 'tenant-1',
            user: {
                uid: 'staff-1',
                tenantId: 'tenant-1',
                role: 'staff',
                permissions: {
                    canManageReservations: true,
                    canManageCustomers: false,
                    canManageMenus: false,
                    canManagePractitioners: false,
                    canManageSettings: false,
                    canViewReports: false,
                    canManageAdmins: false,
                },
                name: 'Staff User',
            },
        };

        const result = await invokeRoute(karteAdminRoutes, 'get', '/');

        expect(result.error).toMatchObject({
            code: 'AUTHORIZATION_ERROR',
            statusCode: 403,
        });
        expect(repositoryState.createKarteRepository).not.toHaveBeenCalled();
    });

    it('rejects invalid visit dates before repository access', async () => {
        const repo = {
            create: vi.fn(),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'post', '/', {
            body: {
                customerId: '7f9b9e1f-96c9-44e2-8dd5-b2f66bb0f001',
                practitionerId: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
                visitDate: '2026/03/17',
            },
        });

        expect(result.error).toMatchObject({
            code: 'VALIDATION_ERROR',
            statusCode: 400,
        });
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('creates kartes and records an audit log', async () => {
        const createdAt = new Date('2026-03-17T01:00:00.000Z');
        const updatedAt = new Date('2026-03-17T02:00:00.000Z');
        const repo = {
            create: vi.fn().mockResolvedValue({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                practitionerId: 'practitioner-1',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                status: 'draft',
                tags: [],
                createdAt,
                updatedAt,
            }),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'post', '/', {
            body: {
                customerId: '7f9b9e1f-96c9-44e2-8dd5-b2f66bb0f001',
                practitionerId: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                tags: [],
            },
            headers: {
                'user-agent': 'Vitest',
            },
            ip: '127.0.0.1',
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(201);
        expect(result.headers.location).toBe('/api/v1/admin/kartes/karte-1');
        expect(auditLogState.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                action: 'CREATE',
                entityType: 'karte',
                entityId: 'karte-1',
                actorType: 'admin',
                actorId: 'admin-1',
                actorName: 'Owner Admin',
                ipAddress: '127.0.0.1',
                userAgent: 'Vitest',
            })
        );
        expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('updates kartes and records both old and new values', async () => {
        const repo = {
            findByIdOrFail: vi.fn().mockResolvedValue({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                practitionerId: 'practitioner-1',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                status: 'draft',
                tags: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
            update: vi.fn().mockResolvedValue({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                practitionerId: 'practitioner-1',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                status: 'completed',
                tags: ['updated'],
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'put', '/:id', {
            params: { id: 'karte-1' },
            body: {
                status: 'completed',
                tags: ['updated'],
            },
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(200);
        expect(repo.findByIdOrFail).toHaveBeenCalledWith('karte-1');
        expect(repo.update).toHaveBeenCalledWith('karte-1', {
            status: 'completed',
            tags: ['updated'],
        });
        expect(auditLogState.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                action: 'UPDATE',
                entityType: 'karte',
                entityId: 'karte-1',
                oldValues: expect.objectContaining({ id: 'karte-1', status: 'draft' }),
                newValues: expect.objectContaining({ id: 'karte-1', status: 'completed' }),
            })
        );
    });

    it('deletes kartes and writes the prior state to the audit log', async () => {
        const repo = {
            findByIdOrFail: vi.fn().mockResolvedValue({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                practitionerId: 'practitioner-1',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                status: 'draft',
                tags: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'delete', '/:id', {
            params: { id: 'karte-1' },
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(200);
        expect(repo.delete).toHaveBeenCalledWith('karte-1');
        expect(auditLogState.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                action: 'DELETE',
                entityType: 'karte',
                entityId: 'karte-1',
                actorType: 'admin',
                actorId: 'admin-1',
                actorName: 'Owner Admin',
                oldValues: expect.objectContaining({ id: 'karte-1' }),
            })
        );
    });

    it('returns detail by id', async () => {
        const repo = {
            findByIdOrFail: vi.fn().mockResolvedValue({
                id: 'karte-1',
                tenantId: 'tenant-1',
                customerId: 'customer-1',
                practitionerId: 'practitioner-1',
                visitDate: '2026-03-17',
                menuIds: [],
                menuNames: [],
                optionIds: [],
                productsUsed: [],
                customFields: {},
                photosBefore: [],
                photosAfter: [],
                photosOther: [],
                status: 'draft',
                tags: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        };
        vi.mocked(repositoryState.createKarteRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteAdminRoutes, 'get', '/:id', {
            params: { id: 'karte-1' },
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(200);
        expect(result.json.data.id).toBe('karte-1');
        expect(repo.findByIdOrFail).toHaveBeenCalledWith('karte-1');
    });
});

describe('karte template admin routes', () => {
    it('creates templates and records an audit log', async () => {
        const repo = {
            create: vi.fn().mockResolvedValue({
                id: 'template-1',
                tenantId: 'tenant-1',
                name: 'Standard Karte',
                description: 'Base template',
                isDefault: false,
                fields: [],
                applicableMenuCategories: [],
                isActive: true,
                displayOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        };
        vi.mocked(repositoryState.createKarteTemplateRepository).mockReturnValue(repo as any);

        const result = await invokeRoute(karteTemplateAdminRoutes, 'post', '/', {
            body: {
                name: 'Standard Karte',
                fields: [],
                applicableMenuCategories: [],
            },
            headers: {
                'user-agent': 'Vitest',
            },
            ip: '127.0.0.1',
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(201);
        expect(auditLogState.writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: 'tenant-1',
                action: 'CREATE',
                entityType: 'karte_template',
                entityId: 'template-1',
                actorType: 'admin',
                actorId: 'admin-1',
                actorName: 'Owner Admin',
            })
        );
        expect(repo.create).toHaveBeenCalledTimes(1);
    });
});
