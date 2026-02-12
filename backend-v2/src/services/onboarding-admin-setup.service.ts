import { z } from 'zod';
import {
    createMenuRepository,
    createPractitionerRepository,
    createStoreRepository,
    createTenantRepository,
} from '../repositories/index.js';
import { ValidationError } from '../utils/errors.js';

const onboardingSetupPayloadSchema = z.object({
    tenantName: z.string().trim().min(1).max(200).optional(),
    storeName: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    address: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(30).optional(),
    slotDuration: z.number().int().min(15).max(120).optional(),
    advanceBookingDays: z.number().int().min(1).max(90).optional(),
    cancelDeadlineHours: z.number().int().min(0).max(72).optional(),
    menuName: z.string().trim().min(1).max(100).optional(),
    menuCategory: z.string().trim().min(1).max(50).optional(),
    menuPrice: z.number().int().min(0).max(1_000_000).optional(),
    menuDuration: z.number().int().min(5).max(480).optional(),
    practitionerName: z.string().trim().min(1).max(100).optional(),
});

export interface OnboardingSetupApplyResult {
    tenantUpdated: boolean;
    storeUpdated: boolean;
    menuApplied: boolean;
    practitionerApplied: boolean;
}

type OnboardingSetupPayload = z.infer<typeof onboardingSetupPayloadSchema>;

export class OnboardingAdminSetupService {
    async apply(tenantId: string, payload: Record<string, unknown>): Promise<OnboardingSetupApplyResult> {
        const parsed = onboardingSetupPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            throw new ValidationError('オンボーディング設定値が不正です');
        }

        const setup = parsed.data;
        const summary: OnboardingSetupApplyResult = {
            tenantUpdated: false,
            storeUpdated: false,
            menuApplied: false,
            practitionerApplied: false,
        };

        await this.applyTenantAndStore(tenantId, setup, summary);
        await this.applyMenu(tenantId, setup, summary);
        await this.applyPractitioner(tenantId, setup, summary);

        return summary;
    }

    private async applyTenantAndStore(
        tenantId: string,
        setup: OnboardingSetupPayload,
        summary: OnboardingSetupApplyResult
    ): Promise<void> {
        if (setup.tenantName) {
            const tenantRepository = createTenantRepository();
            await tenantRepository.update(tenantId, {
                name: setup.tenantName,
            });
            summary.tenantUpdated = true;
        }

        const storeUpdates: Record<string, unknown> = {};
        if (setup.storeName) storeUpdates.name = setup.storeName;
        if (setup.timezone) storeUpdates.timezone = setup.timezone;
        if (setup.address !== undefined) storeUpdates.address = setup.address;
        if (setup.phone !== undefined) storeUpdates.phone = setup.phone;
        if (setup.slotDuration !== undefined) storeUpdates.slotDuration = setup.slotDuration;
        if (setup.advanceBookingDays !== undefined) storeUpdates.advanceBookingDays = setup.advanceBookingDays;
        if (setup.cancelDeadlineHours !== undefined) storeUpdates.cancelDeadlineHours = setup.cancelDeadlineHours;

        if (Object.keys(storeUpdates).length === 0) {
            return;
        }

        const storeRepository = createStoreRepository(tenantId);
        const stores = await storeRepository.findAll();
        const primaryStore = stores[0];
        if (!primaryStore) {
            throw new ValidationError('店舗情報が見つかりません');
        }

        await storeRepository.update(primaryStore.id, storeUpdates);
        summary.storeUpdated = true;
    }

    private async applyMenu(
        tenantId: string,
        setup: OnboardingSetupPayload,
        summary: OnboardingSetupApplyResult
    ): Promise<void> {
        if (!setup.menuName) {
            return;
        }

        const menuRepository = createMenuRepository(tenantId);
        const menus = await menuRepository.findAll({ includeInactive: true });
        const existing = menus.find((menu) => menu.name === setup.menuName);

        const menuData = {
            name: setup.menuName,
            category: setup.menuCategory ?? 'その他',
            price: setup.menuPrice ?? 0,
            duration: setup.menuDuration ?? 60,
            isActive: true,
        };

        if (existing) {
            await menuRepository.updateMenu(existing.id, menuData);
        } else {
            await menuRepository.createMenu(menuData);
        }

        summary.menuApplied = true;
    }

    private async applyPractitioner(
        tenantId: string,
        setup: OnboardingSetupPayload,
        summary: OnboardingSetupApplyResult
    ): Promise<void> {
        if (!setup.practitionerName) {
            return;
        }

        const storeRepository = createStoreRepository(tenantId);
        const stores = await storeRepository.findAll();
        const primaryStore = stores[0];

        const practitionerRepository = createPractitionerRepository(tenantId);
        const practitioners = await practitionerRepository.findAll();
        const existingOwner = practitioners.find(
            (practitioner) =>
                practitioner.name === setup.practitionerName && practitioner.role === 'owner'
        );

        const practitionerData = {
            name: setup.practitionerName,
            role: 'owner' as const,
            color: '#3b82f6',
            nominationFee: 0,
            schedule: {
                workDays: [1, 2, 3, 4, 5, 6],
                workHours: { start: '10:00', end: '19:00' },
            },
            isActive: true,
            storeIds: primaryStore ? [primaryStore.id] : [],
        };

        if (existingOwner) {
            await practitionerRepository.updatePractitioner(existingOwner.id, practitionerData);
        } else {
            await practitionerRepository.createPractitioner(practitionerData);
        }

        summary.practitionerApplied = true;
    }
}

export function createOnboardingAdminSetupService(): OnboardingAdminSetupService {
    return new OnboardingAdminSetupService();
}
