import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const syncMocks = vi.hoisted(() => ({
    googleService: {
        syncCreateEvent: vi.fn(),
        syncUpdateEvent: vi.fn(),
        syncDeleteEvent: vi.fn(),
    },
    queueService: {
        enqueue: vi.fn(),
    },
    reservationRepo: {
        setGoogleCalendarRefs: vi.fn(),
        clearGoogleCalendarRefs: vi.fn(),
    },
}));

vi.mock('../../src/services/google-calendar.service.js', () => ({
    createGoogleCalendarService: () => syncMocks.googleService,
}));

vi.mock('../../src/services/google-calendar-sync-queue.service.js', () => ({
    createGoogleCalendarSyncQueueService: () => syncMocks.queueService,
}));

vi.mock('../../src/repositories/index.js', () => ({
    createReservationRepository: () => syncMocks.reservationRepo,
}));

let createGoogleCalendarSyncService: typeof import('../../src/services/google-calendar-sync.service.js').createGoogleCalendarSyncService;

beforeAll(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
    ({ createGoogleCalendarSyncService } = await import('../../src/services/google-calendar-sync.service.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    syncMocks.googleService.syncCreateEvent.mockReset();
    syncMocks.googleService.syncUpdateEvent.mockReset();
    syncMocks.googleService.syncDeleteEvent.mockReset();
    syncMocks.queueService.enqueue.mockReset();
    syncMocks.reservationRepo.setGoogleCalendarRefs.mockReset();
    syncMocks.reservationRepo.clearGoogleCalendarRefs.mockReset();
});

function sampleReservation(overrides: Record<string, unknown> = {}): any {
    return {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        customerName: '山田 太郎',
        practitionerName: '佐藤',
        menuNames: ['カット'],
        totalPrice: 5000,
        startsAt: '2026-03-22T01:00:00.000Z',
        endsAt: '2026-03-22T01:30:00.000Z',
        ...overrides,
    };
}

describe('google-calendar-sync.service', () => {
    it('enqueues a retry task when Google Calendar creation fails', async () => {
        syncMocks.googleService.syncCreateEvent.mockRejectedValue(new Error('calendar down'));
        syncMocks.queueService.enqueue.mockResolvedValue({ taskId: 'task-1' });

        const service = createGoogleCalendarSyncService('tenant-a');
        service.syncReservationCreation(
            sampleReservation(),
            { calendarId: 'calendar-1' } as any,
            'Asia/Tokyo'
        );

        await new Promise((resolve) => setImmediate(resolve));

        expect(syncMocks.queueService.enqueue).toHaveBeenCalledWith({
            reservationId: 'reservation-1',
            action: 'create',
            calendarId: 'calendar-1',
        });
    });

    it('updates the existing event in place when the practitioner calendar stays the same', async () => {
        syncMocks.googleService.syncUpdateEvent.mockResolvedValue(undefined);

        const service = createGoogleCalendarSyncService('tenant-a');
        service.syncReservationUpdate(
            sampleReservation({ googleCalendarEventId: 'event-1', googleCalendarId: 'calendar-1' }),
            sampleReservation({ googleCalendarEventId: 'event-1', googleCalendarId: 'calendar-1' }),
            { calendarId: 'calendar-1' } as any,
            { calendarId: 'calendar-1' } as any,
            'Asia/Tokyo'
        );

        await new Promise((resolve) => setImmediate(resolve));

        expect(syncMocks.googleService.syncUpdateEvent).toHaveBeenCalledWith(
            'calendar-1',
            'event-1',
            expect.objectContaining({ id: 'reservation-1' }),
            'Asia/Tokyo'
        );
    });
});
