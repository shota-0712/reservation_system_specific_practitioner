import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/utils/errors.js';
import { validateAdvanceBooking, validateCancelDeadline } from '../../src/utils/reservation-policy.js';

describe('reservation-policy', () => {
    it('allows booking when advanceBookingDays is disabled', () => {
        expect(() =>
            validateAdvanceBooking(
                '2099-12-31',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 0,
                    cancelDeadlineHours: 24,
                },
                new Date('2026-02-01T00:00:00Z')
            )
        ).not.toThrow();
    });

    it('rejects booking beyond allowed advance window', () => {
        expect(() =>
            validateAdvanceBooking(
                '2026-04-15',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 30,
                    cancelDeadlineHours: 24,
                },
                new Date('2026-02-01T00:00:00Z')
            )
        ).toThrow(ValidationError);
    });

    it('allows booking on the last allowed day even near timezone midnight', () => {
        expect(() =>
            validateAdvanceBooking(
                '2026-03-03',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 30,
                    cancelDeadlineHours: 24,
                },
                // 2026-02-01 23:59 JST (UTC+9)
                new Date('2026-02-01T14:59:00Z')
            )
        ).not.toThrow();
    });

    it('rejects booking one day after the last allowed day', () => {
        expect(() =>
            validateAdvanceBooking(
                '2026-03-04',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 30,
                    cancelDeadlineHours: 24,
                },
                new Date('2026-02-01T14:59:00Z')
            )
        ).toThrow(ValidationError);
    });

    it('rejects cancellation when deadline has passed', () => {
        expect(() =>
            validateCancelDeadline(
                '2026-02-01',
                '12:00',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 30,
                    cancelDeadlineHours: 4,
                },
                new Date('2026-02-01T00:00:00Z')
            )
        ).toThrow(ValidationError);
    });

    it('allows cancellation when enough lead time remains', () => {
        expect(() =>
            validateCancelDeadline(
                '2026-02-02',
                '12:00',
                {
                    timezone: 'Asia/Tokyo',
                    advanceBookingDays: 30,
                    cancelDeadlineHours: 4,
                },
                new Date('2026-02-01T00:00:00Z')
            )
        ).not.toThrow();
    });
});
