import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Reservation } from '../../src/types/index.js';

let SalonboardService: typeof import('../../src/services/salonboard.service.js').SalonboardService;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ SalonboardService } = await import('../../src/services/salonboard.service.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

function buildReservation(id: string, overrides: Partial<Reservation> = {}): Reservation {
    const now = new Date('2026-03-22T00:00:00.000Z');
    return {
        id,
        tenantId: 'tenant-a',
        customerId: 'customer-1',
        customerName: '顧客A',
        practitionerId: 'pract-1',
        practitionerName: '担当A',
        menuIds: [],
        menuNames: [],
        optionIds: [],
        optionNames: [],
        startsAt: new Date('2026-03-22T01:00:00.000Z'),
        endsAt: new Date('2026-03-22T02:00:00.000Z'),
        timezone: 'Asia/Tokyo',
        duration: 60,
        totalPrice: 7000,
        status: 'confirmed',
        source: 'salonboard',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe('SalonboardService', () => {
    it('returns sanitized config view on updateSettings', async () => {
        const configRepository = {
            upsert: vi.fn().mockResolvedValue({
                tenantId: 'tenant-a',
                isEnabled: true,
                syncDirection: 'inbound',
                username: 'salon-user',
                password: 'salon-pass',
                sessionCookie: 'cookie-123',
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-22T01:00:00.000Z'),
            }),
        };

        const service = new SalonboardService('tenant-a', {
            configRepository: configRepository as any,
        });

        const result = await service.updateSettings({
            isEnabled: true,
            syncDirection: 'inbound',
            username: 'salon-user',
        });

        expect(result).toEqual({
            connected: true,
            isEnabled: true,
            syncDirection: 'inbound',
            hasCredentials: true,
            lastSyncAt: undefined,
            lastSyncStatus: undefined,
            lastSyncError: undefined,
        });
        expect(configRepository.upsert).toHaveBeenCalledWith({
            isEnabled: true,
            syncDirection: 'inbound',
            username: 'salon-user',
        });
    });

    it('creates a reservation during manual sync and writes audit logs', async () => {
        const configRepository = {
            get: vi.fn().mockResolvedValue({
                tenantId: 'tenant-a',
                isEnabled: true,
                syncDirection: 'both',
                username: 'salon-user',
                password: 'salon-pass',
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-22T00:00:00.000Z'),
            }),
            recordSyncOutcome: vi.fn().mockResolvedValue({}),
        };
        const practitionerRepository = {
            findBySalonboardStaffId: vi.fn().mockResolvedValue({
                id: 'pract-1',
                tenantId: 'tenant-a',
                name: '担当A',
                role: 'stylist',
                color: '#3b82f6',
                schedule: {
                    workDays: [1, 2, 3, 4, 5],
                    workHours: { start: '10:00', end: '19:00' },
                },
                displayOrder: 0,
                isActive: true,
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-22T00:00:00.000Z'),
            }),
        };
        const reservationRepository = {
            findBySalonboardReservationId: vi.fn().mockResolvedValue(null),
            hasConflict: vi.fn().mockResolvedValue(false),
            create: vi.fn().mockResolvedValue(buildReservation('reservation-1')),
            update: vi.fn(),
        };
        const client = {
            fetchReservations: vi.fn().mockResolvedValue([
                {
                    externalId: 'sb-1',
                    practitionerStaffId: 'staff-1',
                    customerId: 'customer-1',
                    customerName: '顧客A',
                    startsAt: '2026-03-22T10:00:00.000+09:00',
                    endsAt: '2026-03-22T11:00:00.000+09:00',
                    timezone: 'Asia/Tokyo',
                    totalPrice: 7000,
                    status: 'confirmed',
                    source: 'salonboard',
                },
            ]),
        };
        const auditWriter = vi.fn().mockResolvedValue(undefined);

        const service = new SalonboardService('tenant-a', {
            configRepository: configRepository as any,
            practitionerRepository: practitionerRepository as any,
            reservationRepository: reservationRepository as any,
            client: client as any,
            auditLogWriter: auditWriter as any,
        });

        const result = await service.sync('manual');

        expect(result).toEqual({
            trigger: 'manual',
            fetched: 1,
            created: 1,
            updated: 0,
            conflicts: 0,
            skipped: 0,
            status: 'success',
        });
        expect(reservationRepository.create).toHaveBeenCalledTimes(1);
        expect(reservationRepository.create.mock.calls[0]?.[0]).toMatchObject({
            salonboardReservationId: 'sb-1',
            practitionerId: 'pract-1',
            source: 'salonboard',
        });
        expect(configRepository.recordSyncOutcome).toHaveBeenCalledWith({
            lastSyncAt: expect.any(Date),
            lastSyncStatus: 'success',
            lastSyncError: null,
        });
        expect(auditWriter).toHaveBeenCalledWith(expect.objectContaining({
            action: 'CREATE',
            entityType: 'salonboard_reservation',
        }));
        expect(auditWriter).toHaveBeenCalledWith(expect.objectContaining({
            action: 'SYNC',
            entityType: 'salonboard_sync',
        }));
    });

    it('updates existing reservations and marks conflicts as partial during scheduler sync', async () => {
        const configRepository = {
            get: vi.fn().mockResolvedValue({
                tenantId: 'tenant-a',
                isEnabled: true,
                syncDirection: 'both',
                username: 'salon-user',
                password: 'salon-pass',
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-22T00:00:00.000Z'),
            }),
            recordSyncOutcome: vi.fn().mockResolvedValue({}),
        };
        const practitionerRepository = {
            findBySalonboardStaffId: vi.fn().mockResolvedValue({
                id: 'pract-1',
                tenantId: 'tenant-a',
                name: '担当A',
                role: 'stylist',
                color: '#3b82f6',
                schedule: {
                    workDays: [1, 2, 3, 4, 5],
                    workHours: { start: '10:00', end: '19:00' },
                },
                displayOrder: 0,
                isActive: true,
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-22T00:00:00.000Z'),
            }),
        };
        const reservationRepository = {
            findBySalonboardReservationId: vi.fn()
                .mockResolvedValueOnce(buildReservation('reservation-1', {
                    salonboardReservationId: 'sb-1',
                }))
                .mockResolvedValueOnce(null),
            hasConflict: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true),
            update: vi.fn().mockResolvedValue(buildReservation('reservation-1', {
                salonboardReservationId: 'sb-1',
            })),
            create: vi.fn(),
        };
        const client = {
            fetchReservations: vi.fn().mockResolvedValue([
                {
                    externalId: 'sb-1',
                    practitionerStaffId: 'staff-1',
                    customerId: 'customer-1',
                    customerName: '顧客A',
                    startsAt: '2026-03-22T10:00:00.000+09:00',
                    endsAt: '2026-03-22T11:00:00.000+09:00',
                    timezone: 'Asia/Tokyo',
                    totalPrice: 7000,
                    status: 'confirmed',
                    source: 'salonboard',
                },
                {
                    externalId: 'sb-2',
                    practitionerStaffId: 'staff-1',
                    customerId: 'customer-2',
                    customerName: '顧客B',
                    startsAt: '2026-03-22T12:00:00.000+09:00',
                    endsAt: '2026-03-22T13:00:00.000+09:00',
                    timezone: 'Asia/Tokyo',
                    totalPrice: 8500,
                    status: 'confirmed',
                    source: 'salonboard',
                },
            ]),
        };
        const auditWriter = vi.fn().mockResolvedValue(undefined);

        const service = new SalonboardService('tenant-a', {
            configRepository: configRepository as any,
            practitionerRepository: practitionerRepository as any,
            reservationRepository: reservationRepository as any,
            client: client as any,
            auditLogWriter: auditWriter as any,
        });

        const result = await service.sync('scheduler');

        expect(result).toEqual({
            trigger: 'scheduler',
            fetched: 2,
            created: 0,
            updated: 1,
            conflicts: 1,
            skipped: 0,
            status: 'partial',
        });
        expect(reservationRepository.update).toHaveBeenCalledTimes(1);
        expect(reservationRepository.create).not.toHaveBeenCalled();
        expect(auditWriter).toHaveBeenCalledWith(expect.objectContaining({
            action: 'UPDATE',
            entityType: 'salonboard_reservation',
        }));
        expect(auditWriter).toHaveBeenCalledWith(expect.objectContaining({
            action: 'CONFLICT',
            entityType: 'salonboard_reservation',
        }));
        expect(configRepository.recordSyncOutcome).toHaveBeenCalledWith(expect.objectContaining({
            lastSyncStatus: 'partial',
        }));
    });
});
