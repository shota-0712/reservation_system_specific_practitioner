import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let getMenuRankingData: typeof import('../../src/services/reports-aggregation.service.js').getMenuRankingData;
let getPractitionerRevenueData: typeof import('../../src/services/reports-aggregation.service.js').getPractitionerRevenueData;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const dbModule = await import('../../src/config/database.js');
    const serviceModule = await import('../../src/services/reports-aggregation.service.js');

    DatabaseService = dbModule.DatabaseService;
    getMenuRankingData = serviceModule.getMenuRankingData;
    getPractitionerRevenueData = serviceModule.getPractitionerRevenueData;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('reports-aggregation service', () => {
    it('returns menu ranking from daily_analytics when available', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValueOnce([
            { name: 'カット', count: '12', revenue: '60000' },
        ] as any);

        const result = await getMenuRankingData('tenant-a', '2026-02-01');

        expect(result).toEqual([
            { name: 'カット', count: 12, revenue: 60000 },
        ]);
        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to reservations when daily_analytics is empty', async () => {
        const querySpy = vi
            .spyOn(DatabaseService, 'query')
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                { name: 'カラー', count: '8', revenue: '52000' },
            ] as any);

        const result = await getMenuRankingData('tenant-a', '2026-02-01');

        expect(result).toEqual([
            { name: 'カラー', count: 8, revenue: 52000 },
        ]);
        expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('falls back to reservations when daily_analytics query throws', async () => {
        const querySpy = vi
            .spyOn(DatabaseService, 'query')
            .mockRejectedValueOnce(new Error('column does not exist'))
            .mockResolvedValueOnce([
                { name: 'パーマ', count: '3', revenue: '24000' },
            ] as any);

        const result = await getMenuRankingData('tenant-a', '2026-02-01');

        expect(result).toEqual([
            { name: 'パーマ', count: 3, revenue: 24000 },
        ]);
        expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('returns practitioner revenue from daily_analytics when available', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'query').mockResolvedValueOnce([
            { name: '佐藤', revenue: '75000', customers: '9' },
        ] as any);

        const result = await getPractitionerRevenueData('tenant-a', '2026-02-01');

        expect(result).toEqual([
            { name: '佐藤', revenue: 75000, customers: 9 },
        ]);
        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to reservations for practitioner revenue when daily_analytics is unavailable', async () => {
        const querySpy = vi
            .spyOn(DatabaseService, 'query')
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([
                { name: '山田', revenue: '88000', customers: '11' },
            ] as any);

        const result = await getPractitionerRevenueData('tenant-a', '2026-02-01');

        expect(result).toEqual([
            { name: '山田', revenue: 88000, customers: 11 },
        ]);
        expect(querySpy).toHaveBeenCalledTimes(2);
    });
});
