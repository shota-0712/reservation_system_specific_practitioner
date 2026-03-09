"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { rfmSettingsApi, settingsApi } from "@/lib/api";
import type { RfmThresholdSettings } from "@/lib/api";
import { logger } from "@/lib/logger";
import {
    BookingSettingsSection,
    BusinessHoursSection,
    GeneralSettingsSection,
    IntegrationsSection,
    NotificationsSection,
    SaveActions,
    SettingsErrorBanners,
    SettingsTabNav,
} from "./settings.sections";
import type {
    BusinessHour,
    IntegrationsSettingsForm,
    LineResolvePreviewResponse,
    NotificationSettingsForm,
    ProfileSettingsForm,
    RfmAxisKey,
    RfmScoreKey,
    SaveMessage,
    SettingsResponse,
    SettingsTabId,
} from "./settings.types";
import {
    DEFAULT_BOOKING_SETTINGS,
    DEFAULT_INTEGRATIONS_SETTINGS,
    DEFAULT_NOTIFICATION_SETTINGS,
    DEFAULT_PROFILE_SETTINGS,
    DEFAULT_RFM_SETTINGS,
    buildBusinessHours,
    buildBusinessPayload,
    createInitialBusinessHours,
    isValidUuid,
    mergeBookingSettings,
    mergeIntegrationsSettings,
    normalizeNotificationSettings,
    normalizeRfmSettings,
    validateRfmSettings,
} from "./settings.utils";

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [fetchError, setFetchError] = useState<string | null>(null);
    const [notificationFetchError, setNotificationFetchError] = useState<string | null>(null);
    const [rfmError, setRfmError] = useState<string | null>(null);
    const [rfmValidationError, setRfmValidationError] = useState<string | null>(null);
    const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);

    const [profile, setProfile] = useState<ProfileSettingsForm>(DEFAULT_PROFILE_SETTINGS);
    const [businessHours, setBusinessHours] = useState<BusinessHour[]>(
        createInitialBusinessHours
    );
    const [bookingSettings, setBookingSettings] = useState(DEFAULT_BOOKING_SETTINGS);
    const [notifications, setNotifications] = useState<NotificationSettingsForm>(
        DEFAULT_NOTIFICATION_SETTINGS
    );
    const [rfmSettings, setRfmSettings] = useState<RfmThresholdSettings>(DEFAULT_RFM_SETTINGS);
    const [integrations, setIntegrations] = useState<IntegrationsSettingsForm>(
        DEFAULT_INTEGRATIONS_SETTINGS
    );

    const [linePreview, setLinePreview] = useState<LineResolvePreviewResponse | null>(null);
    const [linePreviewLoading, setLinePreviewLoading] = useState(false);
    const [linePreviewError, setLinePreviewError] = useState<string | null>(null);
    const [linePreviewPractitionerId, setLinePreviewPractitionerId] = useState("");

    const lineDirectInputDisabled = integrations.lineMode === "practitioner";

    const updateProfile = (field: keyof ProfileSettingsForm, value: string) => {
        setProfile((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const updateBusinessHour = (
        index: number,
        patch: Partial<Pick<BusinessHour, "isOpen" | "openTime" | "closeTime">>
    ) => {
        setBusinessHours((prev) =>
            prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, ...patch } : item
            )
        );
    };

    const updateBookingSetting = (
        field: keyof typeof DEFAULT_BOOKING_SETTINGS,
        value: number
    ) => {
        setBookingSettings((prev) => ({
            ...prev,
            [field]: Number.isNaN(value) ? 0 : value,
        }));
    };

    const updateNotification = (
        key: keyof NotificationSettingsForm,
        checked: boolean
    ) => {
        setNotifications((prev) => ({
            ...prev,
            [key]: checked,
        }));
    };

    const updateLineIntegration = (
        field:
            | "lineChannelId"
            | "lineLiffId"
            | "lineChannelAccessToken"
            | "lineChannelSecret",
        value: string
    ) => {
        setIntegrations((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const fetchRfmSettings = async () => {
        const response = await rfmSettingsApi.get();
        if (!response.success || !response.data) {
            throw new Error(response.error?.message || "RFM閾値の読み込みに失敗しました");
        }

        setRfmSettings(normalizeRfmSettings(response.data));
        setRfmError(null);
    };

    const fetchLinePreview = async (practitionerId?: string) => {
        setLinePreviewLoading(true);
        setLinePreviewError(null);

        try {
            const response = await settingsApi.resolveLinePreview({
                practitionerId: practitionerId || undefined,
            });
            if (!response.success || !response.data) {
                throw new Error(
                    response.error?.message || "LINE解決プレビューの取得に失敗しました"
                );
            }
            setLinePreview(response.data as LineResolvePreviewResponse);
        } catch (error) {
            setLinePreview(null);
            setLinePreviewError(
                getErrorMessage(error, "LINE解決プレビューの取得に失敗しました")
            );
        } finally {
            setLinePreviewLoading(false);
        }
    };

    const updateRfmScore = (axis: RfmAxisKey, score: RfmScoreKey, value: string) => {
        const parsed = Number.parseInt(value, 10);
        setRfmSettings((prev) => ({
            ...prev,
            [axis]: {
                ...prev[axis],
                [score]: Number.isNaN(parsed) ? 0 : parsed,
            },
        }));
    };

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const [settingsResult, rfmResult, notificationResult] =
                    await Promise.allSettled([
                        settingsApi.get(),
                        fetchRfmSettings(),
                        settingsApi.getNotifications(),
                    ]);

                if (settingsResult.status === "fulfilled") {
                    const response = settingsResult.value;
                    if (response.success && response.data) {
                        const data = response.data as SettingsResponse;
                        setFetchError(null);
                        setProfile({
                            name: data.store?.name || data.tenant.name || "",
                            phone: data.store?.phone || "",
                            address: data.store?.address || "",
                            email: data.store?.email || "",
                        });
                        setBusinessHours(buildBusinessHours(data.store?.businessHours));
                        setBookingSettings((prev) =>
                            mergeBookingSettings(data.store, prev)
                        );
                        setIntegrations((prev) =>
                            mergeIntegrationsSettings(data, prev)
                        );
                    } else {
                        setFetchError(
                            response.error?.message || "設定の読み込みに失敗しました"
                        );
                    }
                } else {
                    logger.error("Failed to fetch settings:", settingsResult.reason);
                    setFetchError(
                        getErrorMessage(
                            settingsResult.reason,
                            "設定の読み込みに失敗しました"
                        )
                    );
                }

                if (rfmResult.status === "rejected") {
                    logger.error("Failed to fetch RFM settings:", rfmResult.reason);
                    setRfmError(
                        getErrorMessage(
                            rfmResult.reason,
                            "RFM閾値の読み込みに失敗しました"
                        )
                    );
                }

                if (notificationResult.status === "fulfilled") {
                    const response = notificationResult.value;
                    if (response.success && response.data) {
                        setNotifications(normalizeNotificationSettings(response.data));
                        setNotificationFetchError(null);
                    } else {
                        setNotificationFetchError(
                            response.error?.message || "通知設定の読み込みに失敗しました"
                        );
                    }
                } else {
                    logger.error(
                        "Failed to fetch notification settings:",
                        notificationResult.reason
                    );
                    setNotificationFetchError(
                        getErrorMessage(
                            notificationResult.reason,
                            "通知設定の読み込みに失敗しました"
                        )
                    );
                }
            } finally {
                setLoading(false);
            }
        };

        void fetchSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaveMessage(null);

        try {
            if (activeTab === "general") {
                const profileResult = await settingsApi.updateProfile({
                    name: profile.name,
                    phone: profile.phone,
                    address: profile.address,
                    email: profile.email,
                });
                if (!profileResult.success) {
                    throw new Error(profileResult.error?.message || "Failed to save profile");
                }
            }

            if (activeTab === "hours" || activeTab === "booking") {
                if (activeTab === "booking") {
                    const validationMessage = validateRfmSettings(rfmSettings);
                    setRfmValidationError(validationMessage);
                    if (validationMessage) {
                        throw new Error(validationMessage);
                    }
                }

                if (activeTab === "booking") {
                    // RFM first: higher validation risk. If it fails, business settings
                    // are never sent, avoiding a partial save. The two endpoints are
                    // independent on the backend so full atomicity requires a combined
                    // endpoint; sequencing here minimises the partial-save window.
                    const rfmUpdateResult = await rfmSettingsApi.update(rfmSettings);
                    if (!rfmUpdateResult.success || !rfmUpdateResult.data) {
                        const message =
                            rfmUpdateResult.error?.message ||
                            "RFM閾値の保存に失敗しました";
                        setRfmError(message);
                        throw new Error(message);
                    }
                    setRfmSettings(normalizeRfmSettings(rfmUpdateResult.data));
                    setRfmError(null);

                    const businessResult = await settingsApi.updateBusiness(
                        buildBusinessPayload(businessHours, bookingSettings)
                    );
                    if (!businessResult.success) {
                        throw new Error(
                            `予約設定の保存に失敗しました（RFM閾値は保存済み）: ${businessResult.error?.message ?? "unknown error"}`
                        );
                    }
                } else {
                    const businessResult = await settingsApi.updateBusiness(
                        buildBusinessPayload(businessHours, bookingSettings)
                    );
                    if (!businessResult.success) {
                        throw new Error(
                            businessResult.error?.message ||
                                "Failed to save business settings"
                        );
                    }
                }
            }

            if (activeTab === "integrations") {
                const linePayload =
                    integrations.lineMode === "practitioner"
                        ? { mode: "practitioner" as const }
                        : {
                              mode: integrations.lineMode,
                              channelId: integrations.lineChannelId || undefined,
                              liffId: integrations.lineLiffId || undefined,
                              channelAccessToken:
                                  integrations.lineChannelAccessToken || undefined,
                              channelSecret:
                                  integrations.lineChannelSecret || undefined,
                          };

                const lineResult = await settingsApi.updateLine(linePayload);
                if (!lineResult.success) {
                    throw new Error(
                        lineResult.error?.message || "Failed to save LINE settings"
                    );
                }

                await fetchLinePreview(linePreviewPractitionerId || undefined);
            }

            if (activeTab === "notifications") {
                const notificationResult = await settingsApi.updateNotifications(
                    notifications
                );
                if (!notificationResult.success || !notificationResult.data) {
                    throw new Error(
                        notificationResult.error?.message ||
                            "通知設定の保存に失敗しました"
                    );
                }

                setNotifications(
                    normalizeNotificationSettings(notificationResult.data)
                );
                setNotificationFetchError(null);
            }

            setSaveMessage({
                type: "success",
                text:
                    activeTab === "notifications"
                        ? "通知設定を保存しました"
                        : "設定を保存しました",
            });
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            logger.error("Failed to save settings:", error);
            const message = getErrorMessage(error, "保存に失敗しました");
            if (activeTab === "notifications") {
                setNotificationFetchError(message);
            }
            setSaveMessage({ type: "error", text: message });
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (activeTab !== "integrations") {
            return;
        }

        if (linePreviewPractitionerId && !isValidUuid(linePreviewPractitionerId)) {
            setLinePreview(null);
            setLinePreviewError("施術者IDはUUID形式で入力してください。");
            return;
        }

        void fetchLinePreview(linePreviewPractitionerId || undefined);
    }, [activeTab, integrations.lineMode, linePreviewPractitionerId]);

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">設定</h1>
                <p className="text-muted-foreground">店舗の各種設定を管理します</p>
            </div>

            <SettingsErrorBanners
                fetchError={fetchError}
                rfmError={rfmError}
                notificationFetchError={notificationFetchError}
            />

            <SettingsTabNav activeTab={activeTab} onChange={setActiveTab} />

            <div className="max-w-4xl">
                {activeTab === "general" && (
                    <GeneralSettingsSection
                        profile={profile}
                        onChange={updateProfile}
                    />
                )}

                {activeTab === "hours" && (
                    <BusinessHoursSection
                        businessHours={businessHours}
                        onToggleOpen={(index, checked) =>
                            updateBusinessHour(index, { isOpen: checked })
                        }
                        onTimeChange={(index, field, value) =>
                            updateBusinessHour(index, { [field]: value })
                        }
                    />
                )}

                {activeTab === "notifications" && (
                    <NotificationsSection
                        notifications={notifications}
                        onToggle={updateNotification}
                    />
                )}

                {activeTab === "booking" && (
                    <BookingSettingsSection
                        bookingSettings={bookingSettings}
                        rfmSettings={rfmSettings}
                        rfmValidationError={rfmValidationError}
                        onBookingChange={updateBookingSetting}
                        onRfmScoreChange={updateRfmScore}
                    />
                )}

                {activeTab === "integrations" && (
                    <IntegrationsSection
                        integrations={integrations}
                        lineDirectInputDisabled={lineDirectInputDisabled}
                        linePreview={linePreview}
                        linePreviewLoading={linePreviewLoading}
                        linePreviewError={linePreviewError}
                        linePreviewPractitionerId={linePreviewPractitionerId}
                        onLineModeChange={(mode) =>
                            setIntegrations((prev) => ({ ...prev, lineMode: mode }))
                        }
                        onLineFieldChange={updateLineIntegration}
                        onPreviewRefresh={() =>
                            void fetchLinePreview(linePreviewPractitionerId || undefined)
                        }
                        onPreviewPractitionerIdChange={setLinePreviewPractitionerId}
                    />
                )}
            </div>

            <SaveActions
                saveMessage={saveMessage}
                saving={saving}
                onSave={handleSave}
            />
        </div>
    );
}
