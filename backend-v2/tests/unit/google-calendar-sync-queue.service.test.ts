import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let createGoogleCalendarSyncQueueService: typeof import('../../src/services/google-calendar-sync-queue.service.js').createGoogleCalendarSyncQueueService;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ createGoogleCalendarSyncQueueService } = await import('../../src/services/google-calendar-sync-queue.service.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('google-calendar-sync-queue-service retry', () => {
    it('requeues dead tasks by default', async () => {
        const querySpy = vi
            .spyOn(DatabaseService, 'query')
            .mockResolvedValue([{ previous_status: 'dead' }, { previous_status: 'dead' }]);

        const service = createGoogleCalendarSyncQueueService('tenant-1');
        const result = await service.retryDeadTasks();

        expect(result).toEqual({
            reset: 2,
            fromDead: 2,
            fromFailed: 0,
        });

        const queryArgs = querySpy.mock.calls[0]?.[1] as [string, string[], number];
        expect(queryArgs).toEqual(['tenant-1', ['dead'], 100]);
    });

    it('can include failed tasks and respects custom limit', async () => {
        const querySpy = vi
            .spyOn(DatabaseService, 'query')
            .mockResolvedValue([
                { previous_status: 'dead' },
                { previous_status: 'failed' },
                { previous_status: 'failed' },
            ]);

        const service = createGoogleCalendarSyncQueueService('tenant-2');
        const result = await service.retryDeadTasks({ limit: 15, includeFailed: true });

        expect(result).toEqual({
            reset: 3,
            fromDead: 1,
            fromFailed: 2,
        });

        const queryArgs = querySpy.mock.calls[0]?.[1] as [string, string[], number];
        expect(queryArgs).toEqual(['tenant-2', ['dead', 'failed'], 15]);
    });

    it('normalizes limit lower than 1 to 1', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValue([]);

        const service = createGoogleCalendarSyncQueueService('tenant-3');
        await service.retryDeadTasks({ limit: 0 });

        const queryArgs = querySpy.mock.calls[0]?.[1] as [string, string[], number];
        expect(queryArgs).toEqual(['tenant-3', ['dead'], 1]);
    });
});
