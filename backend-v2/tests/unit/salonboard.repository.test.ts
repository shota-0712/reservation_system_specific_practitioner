import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let SalonboardConfigRepository: typeof import('../../src/repositories/salonboard.repository.js').SalonboardConfigRepository;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ SalonboardConfigRepository } = await import('../../src/repositories/salonboard.repository.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SalonboardConfigRepository', () => {
    it('returns defaults when no config row exists', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue(null);

        const repository = new SalonboardConfigRepository('tenant-a');
        const result = await repository.get();

        expect(result.tenantId).toBe('tenant-a');
        expect(result.isEnabled).toBe(false);
        expect(result.syncDirection).toBe('both');
        expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('upserts settings and encrypts credentials', async () => {
        const currentRow = {
            tenant_id: 'tenant-a',
            username_encrypted: null,
            password_encrypted: null,
            session_cookie_encrypted: null,
            is_enabled: false,
            sync_direction: 'both',
            last_sync_at: null,
            last_sync_status: null,
            last_sync_error: null,
            created_at: new Date('2026-03-22T00:00:00.000Z'),
            updated_at: new Date('2026-03-22T00:00:00.000Z'),
        };
        const savedRow = {
            ...currentRow,
            username_encrypted: 'enc-user',
            password_encrypted: 'enc-pass',
            session_cookie_encrypted: 'enc-cookie',
            is_enabled: true,
            sync_direction: 'inbound',
            updated_at: new Date('2026-03-22T01:00:00.000Z'),
        };

        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql: string, params?: unknown[]) => {
            if (sql.includes('FROM tenant_salonboard_config')) {
                return currentRow as any;
            }
            if (sql.includes('INSERT INTO tenant_salonboard_config')) {
                expect(params?.[1]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
                expect(params?.[2]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
                expect(params?.[3]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
                expect(params?.[4]).toBe(true);
                expect(params?.[5]).toBe('inbound');
                return savedRow as any;
            }
            return null;
        });

        const repository = new SalonboardConfigRepository('tenant-a');
        const result = await repository.upsert({
            isEnabled: true,
            syncDirection: 'inbound',
            username: 'salon-user',
            password: 'salon-pass',
            sessionCookie: 'cookie-123',
        });

        expect(result.isEnabled).toBe(true);
        expect(result.syncDirection).toBe('inbound');
        expect(result.username).toBe('enc-user');
        expect(result.password).toBe('enc-pass');
        expect(result.sessionCookie).toBe('enc-cookie');
        expect(queryOneSpy).toHaveBeenCalledTimes(2);
    });

    it('records sync outcomes', async () => {
        const queryOneSpy = vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue({
            tenant_id: 'tenant-a',
            username_encrypted: null,
            password_encrypted: null,
            session_cookie_encrypted: null,
            is_enabled: true,
            sync_direction: 'both',
            last_sync_at: new Date('2026-03-22T02:00:00.000Z'),
            last_sync_status: 'success',
            last_sync_error: null,
            created_at: new Date('2026-03-22T00:00:00.000Z'),
            updated_at: new Date('2026-03-22T02:00:00.000Z'),
        } as any);

        const repository = new SalonboardConfigRepository('tenant-a');
        const result = await repository.recordSyncOutcome({
            lastSyncAt: new Date('2026-03-22T02:00:00.000Z'),
            lastSyncStatus: 'success',
            lastSyncError: null,
        });

        expect(result.lastSyncStatus).toBe('success');
        expect(result.lastSyncAt?.toISOString()).toBe('2026-03-22T02:00:00.000Z');
        expect(queryOneSpy).toHaveBeenCalledTimes(1);
    });
});
