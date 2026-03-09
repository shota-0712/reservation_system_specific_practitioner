import type { NotificationSettings, RfmThresholdSettings } from "@/lib/api";

export type SettingsTabId =
    | "general"
    | "hours"
    | "notifications"
    | "booking"
    | "integrations";

export type SaveMessage = {
    type: "success" | "error";
    text: string;
};

export type LineMode = "tenant" | "store" | "practitioner";

export type ProfileSettingsForm = {
    name: string;
    phone: string;
    address: string;
    email: string;
};

export type BusinessHour = {
    day: string;
    dayOfWeek: number;
    isOpen: boolean;
    openTime: string;
    closeTime: string;
};

export type BusinessHoursRecord = Record<
    string,
    {
        isOpen: boolean;
        openTime?: string;
        closeTime?: string;
    }
>;

export type NotificationSettingsForm = Omit<
    NotificationSettings,
    "updatedAt" | "updatedBy"
>;

export type BookingSettingsForm = {
    advanceDays: number;
    cancelDeadlineHours: number;
    slotInterval: number;
};

export type IntegrationsSettingsForm = {
    lineMode: LineMode;
    lineConnected: boolean;
    lineChannelId: string;
    lineLiffId: string;
    lineChannelAccessToken: string;
    lineChannelSecret: string;
};

export interface SettingsResponse {
    tenant: {
        id: string;
        name: string;
        lineConfig?: {
            mode?: LineMode;
            channelId?: string;
            liffId?: string;
        };
    };
    store?: {
        id: string;
        name: string;
        address?: string;
        phone?: string;
        email?: string;
        lineConfig?: {
            channelId?: string;
            liffId?: string;
        };
        businessHours?: BusinessHoursRecord;
        regularHolidays?: number[];
        slotDuration?: number;
        advanceBookingDays?: number;
        cancelDeadlineHours?: number;
    };
}

export interface LineResolvePreviewResponse {
    mode: LineMode;
    source: LineMode;
    liffId: string;
    channelId: string;
    storeId?: string;
    practitionerId?: string;
}

export type RfmAxisKey = keyof RfmThresholdSettings;
export type RfmScoreKey = keyof RfmThresholdSettings["recency"];
