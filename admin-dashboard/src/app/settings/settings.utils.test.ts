import { describe, expect, it } from "vitest";
import {
    DEFAULT_NOTIFICATION_SETTINGS,
    DEFAULT_RFM_SETTINGS,
    buildBusinessHours,
    buildBusinessPayload,
    mergeBookingSettings,
    normalizeNotificationSettings,
    validateRfmSettings,
} from "./settings.utils";

describe("settings.utils", () => {
    it("missing notification fields fall back to defaults", () => {
        expect(
            normalizeNotificationSettings({
                emailNewReservation: false,
                lineConfirmation: false,
            })
        ).toEqual({
            ...DEFAULT_NOTIFICATION_SETTINGS,
            emailNewReservation: false,
            lineConfirmation: false,
        });
    });

    it("rejects invalid recency ordering", () => {
        expect(
            validateRfmSettings({
                ...DEFAULT_RFM_SETTINGS,
                recency: {
                    ...DEFAULT_RFM_SETTINGS.recency,
                    score5: DEFAULT_RFM_SETTINGS.recency.score4,
                },
            })
        ).toContain("Recency");
    });

    it("maps business hours and payload consistently", () => {
        const businessHours = buildBusinessHours({
            "1": { isOpen: true, openTime: "09:00", closeTime: "18:00" },
            "2": { isOpen: false, openTime: "10:00", closeTime: "20:00" },
        });

        const payload = buildBusinessPayload(
            businessHours,
            mergeBookingSettings(undefined, {
                advanceDays: 45,
                cancelDeadlineHours: 12,
                slotInterval: 15,
            })
        );

        expect(businessHours[1]).toMatchObject({
            dayOfWeek: 1,
            isOpen: true,
            openTime: "09:00",
            closeTime: "18:00",
        });
        expect(payload.regularHolidays).toContain(2);
        expect(payload.slotDuration).toBe(15);
    });
});
