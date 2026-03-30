import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

let ReservationRepository: typeof import('../../src/repositories/reservation.repository.js').ReservationRepository;
let DatabaseService: typeof import('../../src/config/database.js').DatabaseService;
let NotFoundError: typeof import('../../src/utils/errors.js').NotFoundError;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ ReservationRepository } = await import('../../src/repositories/reservation.repository.js'));
    ({ DatabaseService } = await import('../../src/config/database.js'));
    ({ NotFoundError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

function buildClient(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown>): PoolClient {
    return {
        query: vi.fn((sql: string, params?: unknown[]) => queryImpl(sql, params)) as unknown as PoolClient['query'],
    } as unknown as PoolClient;
}

function makeReservationRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'reservation-1',
        tenant_id: 'tenant-1',
        store_id: 'store-1',
        customer_id: 'customer-1',
        customer_name: '山田 太郎',
        customer_phone: '09012345678',
        practitioner_id: 'practitioner-1',
        practitioner_name: '佐藤',
        menu_ids: ['menu-1'],
        menu_names: ['カット'],
        option_ids: ['option-1'],
        option_names: ['炭酸スパ'],
        starts_at: new Date('2026-03-17T01:00:00.000Z'),
        ends_at: new Date('2026-03-17T02:00:00.000Z'),
        timezone: 'Asia/Tokyo',
        total_duration: 60,
        total_price: 5000,
        subtotal: 4500,
        option_total: 500,
        nomination_fee: 0,
        discount: 0,
        status: 'pending',
        source: 'admin',
        notes: 'customer note',
        internal_note: 'staff note',
        google_calendar_id: null,
        google_calendar_event_id: null,
        salonboard_reservation_id: null,
        canceled_at: null,
        cancel_reason: null,
        reminder_sent_at: null,
        created_at: new Date('2026-03-10T01:00:00.000Z'),
        updated_at: new Date('2026-03-10T02:00:00.000Z'),
        ...overrides,
    };
}

describe('ReservationRepository', () => {
    it('sets cancellation metadata when status changes to canceled', async () => {
        const canceledAt = new Date('2026-03-30T01:23:45.000Z');
        const querySpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql, params, tenantId) => {
            expect(sql).toContain("WHEN $3 = 'canceled' THEN COALESCE(canceled_at, NOW())");
            expect(sql).toContain("WHEN $3 = 'canceled' THEN $4");
            expect(params).toEqual(['reservation-1', 'tenant-1', 'canceled', 'お客様都合']);
            expect(tenantId).toBe('tenant-1');

            return makeReservationRow({
                status: 'canceled',
                canceled_at: canceledAt,
                cancel_reason: 'お客様都合',
            }) as any;
        });

        const repository = new ReservationRepository('tenant-1');
        const updated = await repository.updateStatus('reservation-1', 'canceled', 'お客様都合');

        expect(updated.status).toBe('canceled');
        expect(updated.canceledAt).toEqual(canceledAt);
        expect(updated.cancelReason).toBe('お客様都合');
        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('clears cancellation metadata when status changes away from canceled', async () => {
        const querySpy = vi.spyOn(DatabaseService, 'queryOne').mockImplementation(async (sql, params, tenantId) => {
            expect(sql).toContain("WHEN $3 = 'canceled' THEN COALESCE(canceled_at, NOW())");
            expect(sql).toContain("WHEN $3 = 'canceled' THEN $4");
            expect(params).toEqual(['reservation-1', 'tenant-1', 'confirmed', null]);
            expect(tenantId).toBe('tenant-1');

            return makeReservationRow({
                status: 'confirmed',
                canceled_at: null,
                cancel_reason: null,
            }) as any;
        });

        const repository = new ReservationRepository('tenant-1');
        const updated = await repository.updateStatus('reservation-1', 'confirmed');

        expect(updated.status).toBe('confirmed');
        expect(updated.canceledAt).toBeUndefined();
        expect(updated.cancelReason).toBeUndefined();
        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('clears cancellation metadata in updateWithItems when restoring a reservation', async () => {
        let updateSql = '';
        let updateParams: unknown[] | undefined;

        vi.spyOn(DatabaseService, 'transaction').mockImplementation(async (callback) => {
            const client = buildClient(async (sql, params) => {
                if (sql.includes('UPDATE reservations SET')) {
                    updateSql = sql;
                    updateParams = params;
                    return {
                        rows: [
                            makeReservationRow({
                                status: 'confirmed',
                                canceled_at: null,
                                cancel_reason: null,
                            }),
                        ],
                    };
                }

                return { rows: [], rowCount: 1 };
            });

            return callback(client);
        });
        const querySpy = vi.spyOn(DatabaseService, 'query')
            .mockResolvedValueOnce([] as any)
            .mockResolvedValueOnce([] as any);

        const repository = new ReservationRepository('tenant-1');
        const updated = await repository.updateWithItems('reservation-1', {
            storeId: 'store-1',
            customerId: 'customer-1',
            customerName: '山田 太郎',
            customerPhone: '09012345678',
            practitionerId: 'practitioner-1',
            practitionerName: '佐藤',
            startsAt: new Date('2026-03-17T01:00:00.000Z'),
            endsAt: new Date('2026-03-17T02:00:00.000Z'),
            timezone: 'Asia/Tokyo',
            duration: 60,
            totalPrice: 5000,
            subtotal: 4500,
            optionTotal: 500,
            nominationFee: 0,
            discount: 0,
            status: 'confirmed',
            source: 'admin',
            customerNote: 'customer note',
            staffNote: 'staff note',
            menuItems: [],
            optionItems: [],
        });

        expect(updateSql).toContain("WHEN $9 = 'canceled' THEN COALESCE(canceled_at, NOW())");
        expect(updateSql).toContain("WHEN $9 = 'canceled' THEN cancel_reason");
        expect(updateParams?.[8]).toBe('confirmed');
        expect(updated.status).toBe('confirmed');
        expect(updated.canceledAt).toBeUndefined();
        expect(updated.cancelReason).toBeUndefined();
        expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundError when updateStatus cannot find the reservation', async () => {
        vi.spyOn(DatabaseService, 'queryOne').mockResolvedValue(null);

        const repository = new ReservationRepository('tenant-1');

        await expect(repository.updateStatus('missing', 'confirmed')).rejects.toBeInstanceOf(NotFoundError);
    });
});
