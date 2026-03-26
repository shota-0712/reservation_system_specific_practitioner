import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const serviceMessageMocks = vi.hoisted(() => ({
    query: vi.fn(),
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
    DatabaseService: {
        query: serviceMessageMocks.query,
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        info: serviceMessageMocks.loggerInfo,
        warn: serviceMessageMocks.loggerWarn,
        error: serviceMessageMocks.loggerError,
    },
}));

let createServiceMessageService: typeof import('../../src/services/service-message.service.js').createServiceMessageService;
let ServiceMessageService: typeof import('../../src/services/service-message.service.js').ServiceMessageService;

const reservation = {
    id: '44444444-4444-4444-8444-444444444444',
    tenantId: 'tenant-1',
    customerId: '55555555-5555-4555-8555-555555555555',
    practitionerId: '66666666-6666-4666-8666-666666666666',
    practitionerName: '担当者',
    menuIds: [],
    menuNames: ['カット'],
    optionIds: [],
    optionNames: [],
    startsAt: '2026-03-22T01:00:00.000Z',
    endsAt: '2026-03-22T02:00:00.000Z',
    timezone: 'Asia/Tokyo',
    duration: 60,
    totalPrice: 5500,
    status: 'confirmed',
    source: 'customer',
    createdAt: new Date('2026-03-22T00:00:00.000Z'),
    updatedAt: new Date('2026-03-22T00:00:00.000Z'),
} as any;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    const module = await import('../../src/services/service-message.service.js');
    createServiceMessageService = module.createServiceMessageService;
    ServiceMessageService = module.ServiceMessageService;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('service-message.service', () => {
    it('writes a success row to service_message_logs after a successful push', async () => {
        vi.spyOn(ServiceMessageService.prototype as any, 'resolveLineConfigContext').mockResolvedValue({
            tenant: { id: 'tenant-1', name: 'Smoke Salon' },
            store: null,
            practitioner: null,
            line: {
                mode: 'tenant',
                source: 'tenant',
                lineConfig: {
                    channelAccessToken: 'plain-access-token',
                    liffId: 'liff-id',
                },
            },
        });
        vi.spyOn(ServiceMessageService.prototype as any, 'buildTemplateArgs').mockReturnValue({
            title: 'Reminder',
            store_name: 'Smoke Salon',
            date: '2026-03-22',
            time: '10:00',
            menu: 'カット',
            practitioner: '担当者',
            duration: '60',
            price: '5500',
        });
        vi.spyOn(ServiceMessageService.prototype as any, 'buildFlexMessage').mockReturnValue({
            type: 'flex',
            altText: 'Reminder',
            contents: {},
        });
        serviceMessageMocks.query.mockResolvedValue([] as any);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({}),
        }));

        const result = await createServiceMessageService('tenant-1').sendDayBeforeReminder('line-user-1', reservation);

        expect(result).toEqual({ success: true });
        expect(serviceMessageMocks.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO service_message_logs'),
            ['tenant-1', reservation.id, 'reminder_day_before', 'success', null],
            'tenant-1'
        );
    });

    it('writes a failed row to service_message_logs after a failed push', async () => {
        vi.spyOn(ServiceMessageService.prototype as any, 'resolveLineConfigContext').mockResolvedValue({
            tenant: { id: 'tenant-1', name: 'Smoke Salon' },
            store: null,
            practitioner: null,
            line: {
                mode: 'tenant',
                source: 'tenant',
                lineConfig: {
                    channelAccessToken: 'plain-access-token',
                    liffId: 'liff-id',
                },
            },
        });
        vi.spyOn(ServiceMessageService.prototype as any, 'buildTemplateArgs').mockReturnValue({
            title: 'Reminder',
            store_name: 'Smoke Salon',
            date: '2026-03-22',
            time: '10:00',
            menu: 'カット',
            practitioner: '担当者',
            duration: '60',
            price: '5500',
        });
        vi.spyOn(ServiceMessageService.prototype as any, 'buildFlexMessage').mockReturnValue({
            type: 'flex',
            altText: 'Reminder',
            contents: {},
        });
        serviceMessageMocks.query.mockResolvedValue([] as any);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: vi.fn().mockResolvedValue({ message: 'bad request' }),
        }));

        const result = await createServiceMessageService('tenant-1').sendSameDayReminder('line-user-1', reservation);

        expect(result.success).toBe(false);
        expect(result.error).toContain('LINE API error: 500');
        expect(serviceMessageMocks.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO service_message_logs'),
            [
                'tenant-1',
                reservation.id,
                'reminder_same_day',
                'failed',
                expect.stringContaining('LINE API error: 500'),
            ],
            'tenant-1'
        );
    });
});
