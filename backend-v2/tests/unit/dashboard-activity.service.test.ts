import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let getDashboardActivity: typeof import('../../src/services/dashboard-activity.service.js').getDashboardActivity;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
    ({ getDashboardActivity } = await import('../../src/services/dashboard-activity.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getDashboardActivity', () => {
    it('maps audit logs to response format', async () => {
        vi.spyOn(DatabaseService, 'query').mockResolvedValue([
            {
                action: 'UPDATE',
                entity_type: 'reservation',
                entity_id: 'r-1',
                actor_type: 'admin',
                actor_id: 'uid-1',
                actor_name: 'Owner',
                created_at: '2026-03-06T00:00:00.000Z',
            } as any,
        ]);

        const result = await getDashboardActivity('tenant-a', 20);

        expect(result).toEqual([
            {
                action: 'UPDATE',
                entityType: 'reservation',
                entityId: 'r-1',
                actorType: 'admin',
                actorId: 'uid-1',
                actorName: 'Owner',
                createdAt: '2026-03-06T00:00:00.000Z',
            },
        ]);
        expect(DatabaseService.query).toHaveBeenCalledTimes(1);
    });

    it.each(['42P01', '42703', '42501', '22P02'])(
        'returns empty list on recoverable audit log error (%s)',
        async (code) => {
            vi.spyOn(DatabaseService, 'query').mockRejectedValue({
                code,
                message: `simulated ${code}`,
            });

            const result = await getDashboardActivity('tenant-a', 20);
            expect(result).toEqual([]);
        }
    );

    it('rethrows non-recoverable errors', async () => {
        vi.spyOn(DatabaseService, 'query').mockRejectedValue(new Error('db down'));

        await expect(getDashboardActivity('tenant-a', 20)).rejects.toThrow('db down');
    });
});

