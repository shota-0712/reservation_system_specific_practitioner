import { beforeAll, describe, expect, it } from 'vitest';

let calculateCustomerReservationStats: typeof import('../../src/repositories/customer.repository.js').calculateCustomerReservationStats;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ calculateCustomerReservationStats } = await import('../../src/repositories/customer.repository.js'));
});

describe('calculateCustomerReservationStats', () => {
    it('counts only completed reservations into visit/spend stats while preserving cancel and no-show counts', () => {
        const stats = calculateCustomerReservationStats([
            { status: 'confirmed', total_price: 5000, starts_at: '2026-03-10T01:00:00.000Z' },
            { status: 'completed', total_price: 7000, starts_at: '2026-03-12T01:00:00.000Z' },
            { status: 'canceled', total_price: 9000, starts_at: '2026-03-14T01:00:00.000Z' },
            { status: 'no_show', total_price: 4000, starts_at: '2026-03-15T01:00:00.000Z' },
            { status: 'completed', total_price: 3000, starts_at: '2026-03-05T01:00:00.000Z' },
        ]);

        expect(stats).toEqual({
            totalVisits: 2,
            totalSpend: 10000,
            averageSpend: 5000,
            firstVisitAt: '2026-03-05T01:00:00.000Z',
            lastVisitAt: '2026-03-12T01:00:00.000Z',
            cancelCount: 1,
            noShowCount: 1,
        });
    });

    it('stays idempotent for same-status updates by recomputing from the current reservation set', () => {
        const currentReservations = [
            { status: 'completed', total_price: 8000, starts_at: '2026-03-18T01:00:00.000Z' },
            { status: 'canceled', total_price: 8000, starts_at: '2026-03-20T01:00:00.000Z' },
        ] as const;

        const firstRun = calculateCustomerReservationStats([...currentReservations]);
        const secondRun = calculateCustomerReservationStats([...currentReservations]);

        expect(secondRun).toEqual(firstRun);
    });

    it('repairs aggregates after a completed reservation is restored back to canceled', () => {
        const stats = calculateCustomerReservationStats([
            { status: 'completed', total_price: 6000, starts_at: '2026-03-01T01:00:00.000Z' },
            { status: 'canceled', total_price: 9000, starts_at: '2026-03-20T01:00:00.000Z' },
        ]);

        expect(stats).toEqual({
            totalVisits: 1,
            totalSpend: 6000,
            averageSpend: 6000,
            firstVisitAt: '2026-03-01T01:00:00.000Z',
            lastVisitAt: '2026-03-01T01:00:00.000Z',
            cancelCount: 1,
            noShowCount: 0,
        });
    });
});
