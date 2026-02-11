import { format, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { ValidationError } from './errors.js';

export interface ReservationPolicyConfig {
    timezone: string;
    advanceBookingDays: number;
    cancelDeadlineHours: number;
}

function hoursBetween(now: Date, future: Date): number {
    return (future.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function validateAdvanceBooking(
    targetDate: string,
    config: ReservationPolicyConfig,
    now = new Date()
): void {
    const { timezone, advanceBookingDays } = config;
    if (advanceBookingDays <= 0) return;

    // Align with slots calculation: compare by "date string in store timezone" (not UTC timestamp math).
    const nowInTimezone = toZonedTime(now, timezone);
    const limit = new Date(nowInTimezone);
    limit.setDate(limit.getDate() + advanceBookingDays);
    const limitDate = format(limit, 'yyyy-MM-dd', { timeZone: timezone });

    if (targetDate > limitDate) {
        throw new ValidationError(`予約は${advanceBookingDays}日先まで受け付けています`);
    }
}

export function validateCancelDeadline(
    reservationDate: string,
    reservationStartTime: string,
    config: ReservationPolicyConfig,
    now = new Date()
): void {
    const { timezone, cancelDeadlineHours } = config;

    if (cancelDeadlineHours <= 0) return;

    const reservationStartUtc = fromZonedTime(
        `${reservationDate}T${reservationStartTime}:00`,
        timezone
    );
    const remainingHours = hoursBetween(now, reservationStartUtc);

    if (remainingHours < cancelDeadlineHours) {
        throw new ValidationError(`キャンセルは予約時刻の${cancelDeadlineHours}時間前まで可能です`);
    }
}
