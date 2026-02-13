import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

let createBookingLinkTokenService: typeof import('../../src/services/booking-link-token.service.js').createBookingLinkTokenService;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let repositories: typeof import('../../src/repositories/index.js');

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ createBookingLinkTokenService } = await import('../../src/services/booking-link-token.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
    repositories = await import('../../src/repositories/index.js');
});

afterEach(() => {
    vi.restoreAllMocks();
});

function buildClient(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown>): PoolClient {
    return {
        query: vi.fn((sql: string, params?: unknown[]) => queryImpl(sql, params)) as unknown as PoolClient['query'],
    } as unknown as PoolClient;
}

describe('booking-link-token.service', () => {
    it('returns null for invalid token format', async () => {
        const service = createBookingLinkTokenService();
        await expect(service.resolve('invalid token')).resolves.toBeNull();
    });

    it('creates active token row', async () => {
        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql) => {
                if (sql.includes('UPDATE booking_link_tokens')) {
                    return { rowCount: 1, rows: [] };
                }
                if (sql.includes('SELECT id FROM booking_link_tokens WHERE token')) {
                    return { rowCount: 0, rows: [] };
                }
                if (sql.includes('INSERT INTO booking_link_tokens')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            id: '0e715a0e-3f60-4c22-b593-660ca6f0e540',
                            tenant_id: 'tenant-1',
                            store_id: null,
                            practitioner_id: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
                            token: 'A23456789012345678901234567890',
                            status: 'active',
                            created_by: 'uid-1',
                            created_at: new Date('2026-02-13T00:00:00.000Z'),
                            last_used_at: null,
                            expires_at: null,
                        }],
                    };
                }
                return { rowCount: 0, rows: [] };
            });
            return callback(client);
        });

        const service = createBookingLinkTokenService('tenant-1');
        const created = await service.create({
            practitionerId: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
            createdBy: 'uid-1',
            reissue: true,
        });

        expect(created.tenantId).toBe('tenant-1');
        expect(created.status).toBe('active');
        expect(created.practitionerId).toBe('9f7dbab5-f815-4b8e-a00b-552b62993c62');
        expect(created.token.length).toBeGreaterThanOrEqual(16);
    });

    it('resolves token and returns practitioner-source line config metadata', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql) => {
            if (sql.includes('FROM booking_link_tokens')) {
                return {
                    id: 'id-1',
                    tenant_id: 'tenant-1',
                    store_id: '95eca622-38e5-4c91-b2a0-51c46243fc6a',
                    practitioner_id: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
                    token: 'A23456789012345678901234567890',
                    status: 'active',
                    created_by: 'uid-1',
                    created_at: new Date('2026-02-13T00:00:00.000Z'),
                    last_used_at: null,
                    expires_at: null,
                };
            }
            return null;
        });
        vi.spyOn(DatabaseService, 'query').mockResolvedValue([]);

        vi.spyOn(repositories, 'createTenantRepository').mockReturnValue({
            findById: vi.fn().mockResolvedValue({
                id: 'tenant-1',
                slug: 'default',
                name: 'Tenant',
                plan: 'trial',
                status: 'active',
                lineConfig: {
                    mode: 'practitioner',
                    liffId: 'tenant-liff',
                    channelId: 'tenant-channel',
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        } as any);
        vi.spyOn(repositories, 'createStoreRepository').mockReturnValue({
            findById: vi.fn().mockResolvedValue({
                id: '95eca622-38e5-4c91-b2a0-51c46243fc6a',
                tenantId: 'tenant-1',
                storeCode: 'default000',
                name: 'Main Store',
                status: 'active',
                lineConfig: {
                    liffId: 'store-liff',
                    channelId: 'store-channel',
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        } as any);
        vi.spyOn(repositories, 'createPractitionerRepository').mockReturnValue({
            findById: vi.fn().mockResolvedValue({
                id: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
                tenantId: 'tenant-1',
                name: '担当者',
                role: 'stylist',
                color: '#3b82f6',
                schedule: {
                    workDays: [1, 2, 3, 4, 5],
                    workHours: { start: '10:00', end: '19:00' },
                },
                displayOrder: 0,
                isActive: true,
                lineConfig: {
                    liffId: 'practitioner-liff',
                    channelId: 'practitioner-channel',
                },
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        } as any);

        const service = createBookingLinkTokenService();
        const resolved = await service.resolve('A23456789012345678901234567890');

        expect(resolved).toMatchObject({
            tenantId: 'tenant-1',
            tenantKey: 'default',
            practitionerId: '9f7dbab5-f815-4b8e-a00b-552b62993c62',
            lineMode: 'practitioner',
            lineConfigSource: 'practitioner',
        });
    });
});
