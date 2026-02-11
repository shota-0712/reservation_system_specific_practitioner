import { createStoreRepository } from '../repositories/index.js';
import { ValidationError } from '../utils/errors.js';
import { validateAdvanceBooking, validateCancelDeadline, type ReservationPolicyConfig } from '../utils/reservation-policy.js';
import type { Reservation, Store } from '../types/index.js';

export interface ResolvedStoreContext {
    store: Store;
    policy: ReservationPolicyConfig;
}

export async function resolveStoreContext(tenantId: string, storeId?: string): Promise<ResolvedStoreContext> {
    const storeRepo = createStoreRepository(tenantId);

    let store: Store | null = null;
    if (storeId) {
        store = await storeRepo.findById(storeId);
    }

    if (!store) {
        const stores = await storeRepo.findAll();
        store = stores[0] || null;
    }

    if (!store) {
        throw new ValidationError('店舗設定が見つかりません');
    }

    return {
        store,
        policy: {
            timezone: store.timezone || 'Asia/Tokyo',
            advanceBookingDays: store.advanceBookingDays || 30,
            cancelDeadlineHours: store.cancelDeadlineHours || 24,
        },
    };
}

export function enforceAdvanceBookingPolicy(date: string, policy: ReservationPolicyConfig): void {
    validateAdvanceBooking(date, policy);
}

export function enforceCancelPolicy(reservation: Reservation, policy: ReservationPolicyConfig): void {
    validateCancelDeadline(reservation.date, reservation.startTime, policy);
}
