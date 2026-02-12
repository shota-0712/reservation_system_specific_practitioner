import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const tenantRepositoryMock = {
    update: vi.fn(),
};

const storeRepositoryMock = {
    findAll: vi.fn(),
    update: vi.fn(),
};

const menuRepositoryMock = {
    findAll: vi.fn(),
    createMenu: vi.fn(),
    updateMenu: vi.fn(),
};

const practitionerRepositoryMock = {
    findAll: vi.fn(),
    createPractitioner: vi.fn(),
    updatePractitioner: vi.fn(),
};

vi.mock('../../src/repositories/index.js', () => ({
    createTenantRepository: vi.fn(() => tenantRepositoryMock),
    createStoreRepository: vi.fn(() => storeRepositoryMock),
    createMenuRepository: vi.fn(() => menuRepositoryMock),
    createPractitionerRepository: vi.fn(() => practitionerRepositoryMock),
}));

let createOnboardingAdminSetupService: typeof import('../../src/services/onboarding-admin-setup.service.js').createOnboardingAdminSetupService;
let ValidationError: typeof import('../../src/utils/errors.js').ValidationError;

beforeAll(async () => {
    ({ createOnboardingAdminSetupService } = await import('../../src/services/onboarding-admin-setup.service.js'));
    ({ ValidationError } = await import('../../src/utils/errors.js'));
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('onboarding-admin-setup-service', () => {
    it('applies tenant/store/policy updates', async () => {
        storeRepositoryMock.findAll.mockResolvedValue([{ id: 'store-1' }]);
        menuRepositoryMock.findAll.mockResolvedValue([]);
        practitionerRepositoryMock.findAll.mockResolvedValue([]);

        const service = createOnboardingAdminSetupService();
        const result = await service.apply('tenant-1', {
            tenantName: 'New Salon',
            storeName: 'Main Store',
            timezone: 'Asia/Tokyo',
            address: 'Tokyo',
            phone: '09012345678',
            slotDuration: 45,
            advanceBookingDays: 21,
            cancelDeadlineHours: 12,
        });

        expect(tenantRepositoryMock.update).toHaveBeenCalledWith('tenant-1', { name: 'New Salon' });
        expect(storeRepositoryMock.update).toHaveBeenCalledWith('store-1', {
            name: 'Main Store',
            timezone: 'Asia/Tokyo',
            address: 'Tokyo',
            phone: '09012345678',
            slotDuration: 45,
            advanceBookingDays: 21,
            cancelDeadlineHours: 12,
        });
        expect(result).toEqual({
            tenantUpdated: true,
            storeUpdated: true,
            menuApplied: false,
            practitionerApplied: false,
        });
    });

    it('updates existing menu/practitioner by name', async () => {
        storeRepositoryMock.findAll.mockResolvedValue([{ id: 'store-1' }]);
        menuRepositoryMock.findAll.mockResolvedValue([{ id: 'menu-1', name: '初期メニュー' }]);
        practitionerRepositoryMock.findAll.mockResolvedValue([{ id: 'prac-1', name: 'オーナー' }]);

        const service = createOnboardingAdminSetupService();
        const result = await service.apply('tenant-1', {
            menuName: '初期メニュー',
            menuCategory: 'カット',
            menuPrice: 5500,
            menuDuration: 60,
            practitionerName: 'オーナー',
        });

        expect(menuRepositoryMock.updateMenu).toHaveBeenCalledWith('menu-1', {
            name: '初期メニュー',
            category: 'カット',
            price: 5500,
            duration: 60,
            isActive: true,
        });
        expect(menuRepositoryMock.createMenu).not.toHaveBeenCalled();

        expect(practitionerRepositoryMock.updatePractitioner).toHaveBeenCalledWith(
            'prac-1',
            expect.objectContaining({
                name: 'オーナー',
                role: 'owner',
                storeIds: ['store-1'],
            })
        );
        expect(practitionerRepositoryMock.createPractitioner).not.toHaveBeenCalled();

        expect(result).toEqual({
            tenantUpdated: false,
            storeUpdated: false,
            menuApplied: true,
            practitionerApplied: true,
        });
    });

    it('creates menu/practitioner when they do not exist', async () => {
        storeRepositoryMock.findAll.mockResolvedValue([{ id: 'store-1' }]);
        menuRepositoryMock.findAll.mockResolvedValue([]);
        practitionerRepositoryMock.findAll.mockResolvedValue([]);

        const service = createOnboardingAdminSetupService();
        const result = await service.apply('tenant-1', {
            menuName: 'カット',
            practitionerName: '初期スタッフ',
        });

        expect(menuRepositoryMock.createMenu).toHaveBeenCalledWith({
            name: 'カット',
            category: 'その他',
            price: 0,
            duration: 60,
            isActive: true,
        });
        expect(practitionerRepositoryMock.createPractitioner).toHaveBeenCalledWith(
            expect.objectContaining({
                name: '初期スタッフ',
                role: 'owner',
                storeIds: ['store-1'],
            })
        );
        expect(result).toEqual({
            tenantUpdated: false,
            storeUpdated: false,
            menuApplied: true,
            practitionerApplied: true,
        });
    });

    it('throws validation error for invalid setup payload', async () => {
        const service = createOnboardingAdminSetupService();
        await expect(
            service.apply('tenant-1', {
                slotDuration: 5,
            })
        ).rejects.toBeInstanceOf(ValidationError);
    });
});
