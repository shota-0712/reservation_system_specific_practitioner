import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const menuRepositoryMock = {
    findByIdsOrFail: vi.fn(),
};

const optionRepositoryMock = {
    findByIdsOrFail: vi.fn(),
};

const createMenuRepositoryMock = vi.fn(() => menuRepositoryMock);
const createOptionRepositoryMock = vi.fn(() => optionRepositoryMock);

vi.mock('../../src/repositories/index.js', () => ({
    createReservationRepository: vi.fn(),
    createMenuRepository: createMenuRepositoryMock,
    createPractitionerRepository: vi.fn(),
    createOptionRepository: createOptionRepositoryMock,
}));

vi.mock('../../src/services/service-message.service.js', () => ({
    createServiceMessageService: vi.fn(),
}));

vi.mock('../../src/services/google-calendar-sync.service.js', () => ({
    createGoogleCalendarSyncService: vi.fn(),
}));

vi.mock('../../src/services/audit-log.service.js', () => ({
    getRequestMeta: vi.fn(),
    writeAuditLog: vi.fn(),
}));

let createReservationService: typeof import('../../src/services/reservation.service.js').createReservationService;
let NotFoundError: typeof import('../../src/utils/errors.js').NotFoundError;

beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 32) {
        process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }

    ({ createReservationService } = await import('../../src/services/reservation.service.js'));
    ({ NotFoundError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('ReservationService.resolveMenusAndOptions', () => {
    it('uses bulk repository fetches and aggregates menu/option totals', async () => {
        menuRepositoryMock.findByIdsOrFail.mockResolvedValue([
            { id: 'menu-1', name: 'Cut', duration: 60, price: 5500 },
            { id: 'menu-2', name: 'Color', duration: 90, price: 8800 },
        ]);
        optionRepositoryMock.findByIdsOrFail.mockResolvedValue([
            { id: 'option-1', name: 'Shampoo', duration: 10, price: 1100 },
            { id: 'option-2', name: 'Spa', duration: 20, price: 2200 },
        ]);

        const service = createReservationService('tenant-1');
        const result = await service.resolveMenusAndOptions(['menu-1', 'menu-2'], ['option-1', 'option-2']);

        expect(createMenuRepositoryMock).toHaveBeenCalledWith('tenant-1');
        expect(createOptionRepositoryMock).toHaveBeenCalledWith('tenant-1');
        expect(menuRepositoryMock.findByIdsOrFail).toHaveBeenCalledTimes(1);
        expect(menuRepositoryMock.findByIdsOrFail).toHaveBeenCalledWith(['menu-1', 'menu-2']);
        expect(optionRepositoryMock.findByIdsOrFail).toHaveBeenCalledTimes(1);
        expect(optionRepositoryMock.findByIdsOrFail).toHaveBeenCalledWith(['option-1', 'option-2']);
        expect(result).toEqual({
            menus: [
                { id: 'menu-1', name: 'Cut', duration: 60, price: 5500 },
                { id: 'menu-2', name: 'Color', duration: 90, price: 8800 },
            ],
            options: [
                { id: 'option-1', name: 'Shampoo', duration: 10, price: 1100 },
                { id: 'option-2', name: 'Spa', duration: 20, price: 2200 },
            ],
            totalDuration: 180,
            menuPrice: 14300,
            optionPrice: 3300,
        });
    });

    it('preserves existing validation behavior when bulk fetch reports a missing menu', async () => {
        menuRepositoryMock.findByIdsOrFail.mockRejectedValue(new NotFoundError('メニュー', 'missing-menu'));
        optionRepositoryMock.findByIdsOrFail.mockResolvedValue([]);

        const service = createReservationService('tenant-1');
        const pending = service.resolveMenusAndOptions(['missing-menu'], []);

        await expect(pending).rejects.toBeInstanceOf(NotFoundError);
        await expect(pending).rejects.toMatchObject({
            details: {
                resource: 'メニュー',
                id: 'missing-menu',
            },
        });
        expect(menuRepositoryMock.findByIdsOrFail).toHaveBeenCalledWith(['missing-menu']);
        expect(optionRepositoryMock.findByIdsOrFail).toHaveBeenCalledWith([]);
    });
});
