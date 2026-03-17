import type { NotificationSettings, RfmThresholdSettings } from "@/lib/api";
import type {
    BookingSettingsForm,
    BusinessHour,
    IntegrationsSettingsForm,
    LineMode,
    NotificationSettingsForm,
    RfmScoreKey,
    SettingsResponse,
} from "./settings.types";

export const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
export const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_RFM_SETTINGS: RfmThresholdSettings = {
    recency: { score5: 30, score4: 60, score3: 90, score2: 180 },
    frequency: { score5: 12, score4: 8, score3: 4, score2: 2 },
    monetary: { score5: 100000, score4: 50000, score3: 20000, score2: 10000 },
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettingsForm = {
    emailNewReservation: true,
    emailCancellation: true,
    emailDailyReport: true,
    lineReminder: true,
    lineConfirmation: true,
    lineReview: true,
    pushNewReservation: true,
    pushCancellation: true,
};

export const DEFAULT_PROFILE_SETTINGS = {
    name: "",
    phone: "",
    address: "",
    email: "",
};

export const DEFAULT_BOOKING_SETTINGS: BookingSettingsForm = {
    advanceDays: 30,
    cancelDeadlineHours: 24,
    slotInterval: 30,
};

export const DEFAULT_INTEGRATIONS_SETTINGS: IntegrationsSettingsForm = {
    lineMode: "tenant",
    lineConnected: false,
    lineChannelId: "",
    lineLiffId: "",
    lineChannelAccessToken: "",
    lineChannelSecret: "",
};

export function createInitialBusinessHours(): BusinessHour[] {
    return DAYS.map((day, index) => ({
        day,
        dayOfWeek: index,
        isOpen: index !== 0,
        openTime: "10:00",
        closeTime: "20:00",
    }));
}

function toPositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const normalized = Math.trunc(parsed);
    return normalized > 0 ? normalized : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function normalizeRfmAxis(
    value: unknown,
    fallback: RfmThresholdSettings["recency"]
): RfmThresholdSettings["recency"] {
    const axis = (value ?? {}) as Partial<Record<RfmScoreKey, unknown>>;
    return {
        score5: toPositiveInteger(axis.score5, fallback.score5),
        score4: toPositiveInteger(axis.score4, fallback.score4),
        score3: toPositiveInteger(axis.score3, fallback.score3),
        score2: toPositiveInteger(axis.score2, fallback.score2),
    };
}

export function normalizeRfmSettings(value: unknown): RfmThresholdSettings {
    const settings = (value ?? {}) as Partial<RfmThresholdSettings>;
    return {
        recency: normalizeRfmAxis(settings.recency, DEFAULT_RFM_SETTINGS.recency),
        frequency: normalizeRfmAxis(settings.frequency, DEFAULT_RFM_SETTINGS.frequency),
        monetary: normalizeRfmAxis(settings.monetary, DEFAULT_RFM_SETTINGS.monetary),
    };
}

export function validateRfmSettings(value: RfmThresholdSettings): string | null {
    const recency = value.recency;
    const frequency = value.frequency;
    const monetary = value.monetary;
    const allValues = [
        recency.score5,
        recency.score4,
        recency.score3,
        recency.score2,
        frequency.score5,
        frequency.score4,
        frequency.score3,
        frequency.score2,
        monetary.score5,
        monetary.score4,
        monetary.score3,
        monetary.score2,
    ];

    if (allValues.some((item) => !Number.isInteger(item) || item <= 0)) {
        return "RFM閾値は1以上の整数で入力してください。";
    }

    if (
        !(
            recency.score5 < recency.score4 &&
            recency.score4 < recency.score3 &&
            recency.score3 < recency.score2
        )
    ) {
        return "Recencyは score5 < score4 < score3 < score2 になるように入力してください。";
    }

    if (
        !(
            frequency.score5 > frequency.score4 &&
            frequency.score4 > frequency.score3 &&
            frequency.score3 > frequency.score2
        )
    ) {
        return "Frequencyは score5 > score4 > score3 > score2 になるように入力してください。";
    }

    if (
        !(
            monetary.score5 > monetary.score4 &&
            monetary.score4 > monetary.score3 &&
            monetary.score3 > monetary.score2
        )
    ) {
        return "Monetaryは score5 > score4 > score3 > score2 になるように入力してください。";
    }

    return null;
}

export function normalizeNotificationSettings(
    value: unknown
): NotificationSettingsForm {
    const settings = (value ?? {}) as Partial<NotificationSettings>;
    return {
        emailNewReservation: toBoolean(
            settings.emailNewReservation,
            DEFAULT_NOTIFICATION_SETTINGS.emailNewReservation
        ),
        emailCancellation: toBoolean(
            settings.emailCancellation,
            DEFAULT_NOTIFICATION_SETTINGS.emailCancellation
        ),
        emailDailyReport: toBoolean(
            settings.emailDailyReport,
            DEFAULT_NOTIFICATION_SETTINGS.emailDailyReport
        ),
        lineReminder: toBoolean(
            settings.lineReminder,
            DEFAULT_NOTIFICATION_SETTINGS.lineReminder
        ),
        lineConfirmation: toBoolean(
            settings.lineConfirmation,
            DEFAULT_NOTIFICATION_SETTINGS.lineConfirmation
        ),
        lineReview: toBoolean(
            settings.lineReview,
            DEFAULT_NOTIFICATION_SETTINGS.lineReview
        ),
        pushNewReservation: toBoolean(
            settings.pushNewReservation,
            DEFAULT_NOTIFICATION_SETTINGS.pushNewReservation
        ),
        pushCancellation: toBoolean(
            settings.pushCancellation,
            DEFAULT_NOTIFICATION_SETTINGS.pushCancellation
        ),
    };
}

export function buildBusinessHours(
    businessHours?: NonNullable<SettingsResponse["store"]>["businessHours"]
): BusinessHour[] {
    const defaultHours = createInitialBusinessHours();

    if (!businessHours) {
        return defaultHours;
    }

    return DAYS.map((day, index) => {
        const found = businessHours[String(index)];
        return {
            day,
            dayOfWeek: index,
            isOpen: found?.isOpen ?? index !== 0,
            openTime: found?.openTime || "10:00",
            closeTime: found?.closeTime || "20:00",
        };
    });
}

export function mergeBookingSettings(
    store: SettingsResponse["store"] | undefined,
    current: BookingSettingsForm
): BookingSettingsForm {
    return {
        ...current,
        advanceDays: store?.advanceBookingDays ?? current.advanceDays,
        cancelDeadlineHours: store?.cancelDeadlineHours ?? current.cancelDeadlineHours,
        slotInterval: store?.slotDuration ?? current.slotInterval,
    };
}

function normalizeLineMode(mode?: LineMode): LineMode {
    if (mode === "store" || mode === "practitioner") {
        return mode;
    }
    return "tenant";
}

export function mergeIntegrationsSettings(
    data: SettingsResponse,
    current: IntegrationsSettingsForm
): IntegrationsSettingsForm {
    if (!data.tenant.lineConfig) {
        return current;
    }

    const lineMode = normalizeLineMode(data.tenant.lineConfig.mode);
    const modeConfig =
        lineMode === "store" ? data.store?.lineConfig : data.tenant.lineConfig;

    return {
        ...current,
        lineMode,
        lineConnected: !!modeConfig?.channelId,
        lineChannelId: modeConfig?.channelId || "",
        lineLiffId: modeConfig?.liffId || "",
    };
}

export function buildBusinessPayload(
    businessHours: BusinessHour[],
    bookingSettings: BookingSettingsForm
) {
    const mappedBusinessHours = businessHours.reduce<
        Record<string, { isOpen: boolean; openTime: string; closeTime: string }>
    >((accumulator, item) => {
        accumulator[String(item.dayOfWeek)] = {
            isOpen: item.isOpen,
            openTime: item.openTime,
            closeTime: item.closeTime,
        };
        return accumulator;
    }, {});

    return {
        businessHours: mappedBusinessHours,
        regularHolidays: businessHours
            .filter((item) => !item.isOpen)
            .map((item) => item.dayOfWeek),
        slotDuration: bookingSettings.slotInterval,
        advanceBookingDays: bookingSettings.advanceDays,
        cancelDeadlineHours: bookingSettings.cancelDeadlineHours,
    };
}

export function isValidUuid(value: string): boolean {
    return UUID_REGEX.test(value);
}
