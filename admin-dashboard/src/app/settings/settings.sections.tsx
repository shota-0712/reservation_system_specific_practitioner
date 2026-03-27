import { useRef, type ChangeEvent } from "react";
import Link from "next/link";
import {
    Bell,
    Check,
    Clock,
    CreditCard,
    ExternalLink,
    ImagePlus,
    Loader2,
    Mail,
    Save,
    Shield,
    Trash2,
    type LucideIcon,
} from "lucide-react";
import type { RfmThresholdSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
    BrandingSettingsForm,
    BookingSettingsForm,
    BusinessHour,
    IntegrationsSettingsForm,
    LineMode,
    LineResolvePreviewResponse,
    NotificationSettingsForm,
    ProfileSettingsForm,
    RfmAxisKey,
    RfmScoreKey,
    SaveMessage,
    SettingsTabId,
} from "./settings.types";

const SETTINGS_TABS: Array<{
    id: SettingsTabId;
    name: string;
    icon: LucideIcon;
}> = [
    { id: "general", name: "店舗情報", icon: ExternalLink },
    { id: "hours", name: "営業時間", icon: Clock },
    { id: "notifications", name: "通知設定", icon: Bell },
    { id: "booking", name: "予約設定", icon: CreditCard },
    { id: "integrations", name: "連携設定", icon: Shield },
];

const EMAIL_NOTIFICATION_ITEMS = [
    { key: "emailNewReservation", label: "新規予約通知", desc: "新しい予約が入った時" },
    { key: "emailCancellation", label: "キャンセル通知", desc: "予約がキャンセルされた時" },
    { key: "emailDailyReport", label: "日次レポート", desc: "毎日の予約状況サマリー" },
] as const;

const LINE_NOTIFICATION_ITEMS = [
    { key: "lineConfirmation", label: "予約確認メッセージ", desc: "予約確定時に自動送信" },
    { key: "lineReminder", label: "リマインダー", desc: "予約前日に自動送信" },
    { key: "lineReview", label: "レビュー依頼", desc: "来店後にレビュー依頼を送信" },
] as const;

const RFM_AXES: Array<{
    key: RfmAxisKey;
    label: string;
    rule: string;
}> = [
    {
        key: "recency",
        label: "Recency（日数）",
        rule: "score5 < score4 < score3 < score2",
    },
    {
        key: "frequency",
        label: "Frequency（来店回数）",
        rule: "score5 > score4 > score3 > score2",
    },
    {
        key: "monetary",
        label: "Monetary（累計利用額）",
        rule: "score5 > score4 > score3 > score2",
    },
];

const LINE_MODE_OPTIONS: Array<{
    value: LineMode;
    title: string;
    description: string;
}> = [
    {
        value: "tenant",
        title: "店舗共通",
        description: "すべての施術者で同じLIFF/Channelを使う",
    },
    {
        value: "store",
        title: "店舗ごと",
        description: "店舗管理で選択中の店舗単位にLIFF/Channelを設定",
    },
    {
        value: "practitioner",
        title: "施術者ごと",
        description: "スタッフ管理で施術者単位のLIFF/Channelを設定",
    },
];

type NotificationKey = keyof NotificationSettingsForm;
type EditableLineField =
    | "lineChannelId"
    | "lineLiffId"
    | "lineChannelAccessToken"
    | "lineChannelSecret";

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const BRANDING_COLOR_PRESETS = [
    { name: "Rose", value: "#E11D48" },
    { name: "Coral", value: "#F97316" },
    { name: "Gold", value: "#D97706" },
    { name: "Emerald", value: "#059669" },
    { name: "Teal", value: "#0F766E" },
    { name: "Sky", value: "#0284C7" },
    { name: "Indigo", value: "#4F46E5" },
    { name: "Slate", value: "#334155" },
] as const;

export function SettingsTabNav({
    activeTab,
    onChange,
}: {
    activeTab: SettingsTabId;
    onChange: (tab: SettingsTabId) => void;
}) {
    return (
        <div className="flex gap-2 overflow-x-auto border-b pb-2">
            {SETTINGS_TABS.map((tab) => (
                <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? "default" : "ghost"}
                    size="sm"
                    onClick={() => onChange(tab.id)}
                    className="flex items-center gap-2"
                >
                    <tab.icon className="h-4 w-4" />
                    {tab.name}
                </Button>
            ))}
        </div>
    );
}

export function SettingsErrorBanners({
    fetchError,
    rfmError,
    notificationFetchError,
}: {
    fetchError: string | null;
    rfmError: string | null;
    notificationFetchError: string | null;
}) {
    return (
        <>
            {fetchError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    設定の読み込みに失敗しました: {fetchError}
                </div>
            )}
            {rfmError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    RFM閾値設定の読み込み/保存に失敗しました: {rfmError}
                </div>
            )}
            {notificationFetchError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    通知設定の読み込み/保存に失敗しました: {notificationFetchError}
                </div>
            )}
        </>
    );
}

export function GeneralSettingsSection({
    profile,
    branding,
    logoUploading,
    logoUploadError,
    onChange,
    onBrandingChange,
    onLogoUpload,
    onLogoRemove,
}: {
    profile: ProfileSettingsForm;
    branding: BrandingSettingsForm;
    logoUploading: boolean;
    logoUploadError: string | null;
    onChange: (field: keyof ProfileSettingsForm, value: string) => void;
    onBrandingChange: (field: keyof BrandingSettingsForm, value: string) => void;
    onLogoUpload: (file: File) => void;
    onLogoRemove: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const previewColor = HEX_COLOR_REGEX.test(branding.primaryColor)
        ? branding.primaryColor
        : "#4F46E5";

    const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        onLogoUpload(file);
        event.target.value = "";
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">店舗基本情報</CardTitle>
                <CardDescription>customer-app に表示する店舗情報とロゴを設定します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label htmlFor="settings-store-name" className="mb-1 block text-sm font-medium">店舗名</label>
                        <input
                            id="settings-store-name"
                            type="text"
                            value={profile.name}
                            onChange={(event) => onChange("name", event.target.value)}
                            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label htmlFor="settings-store-phone" className="mb-1 block text-sm font-medium">電話番号</label>
                        <input
                            id="settings-store-phone"
                            type="tel"
                            value={profile.phone}
                            onChange={(event) => onChange("phone", event.target.value)}
                            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                </div>

                <div>
                    <label htmlFor="settings-store-address" className="mb-1 block text-sm font-medium">住所</label>
                    <input
                        id="settings-store-address"
                        type="text"
                        value={profile.address}
                        onChange={(event) => onChange("address", event.target.value)}
                        className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>

                <div>
                    <label htmlFor="settings-store-email" className="mb-1 block text-sm font-medium">メールアドレス</label>
                    <input
                        id="settings-store-email"
                        type="email"
                        value={profile.email}
                        onChange={(event) => onChange("email", event.target.value)}
                        className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>

                <div className="border-t border-gray-100 pt-4">
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold text-gray-900">customer-app 表示</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            ヘッダーのロゴ画像とテーマカラーを設定します
                        </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_144px]">
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium">ロゴ画像</label>
                                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                        aria-label="ロゴ画像をアップロード"
                                        className="hidden"
                                        onChange={handleLogoFileChange}
                                    />
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                                            {branding.logoUrl ? (
                                                <img
                                                    src={branding.logoUrl}
                                                    alt="現在のロゴ画像"
                                                    className="h-12 w-12 rounded-xl object-cover"
                                                />
                                            ) : (
                                                <ImagePlus className="h-6 w-6 text-gray-400" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900">
                                                {branding.logoUrl ? "ロゴ画像を設定済み" : "ロゴ画像をアップロード"}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                PNG / JPG / WebP / SVG、4MBまで。保存すると customer-app に反映されます
                                            </p>
                                            {branding.logoUrl && (
                                                <p className="mt-2 break-all text-[11px] text-muted-foreground">
                                                    {branding.logoUrl}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={logoUploading}
                                        >
                                            {logoUploading ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <ImagePlus className="mr-2 h-4 w-4" />
                                            )}
                                            {branding.logoUrl ? "画像を変更" : "画像をアップロード"}
                                        </Button>
                                        {branding.logoUrl && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="text-gray-600"
                                                onClick={onLogoRemove}
                                                disabled={logoUploading}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                ロゴを削除
                                            </Button>
                                        )}
                                    </div>
                                    {logoUploadError && (
                                        <p className="mt-3 text-xs text-red-600">{logoUploadError}</p>
                                    )}
                                    <div className="mt-4 border-t border-gray-200 pt-4">
                                        <label htmlFor="settings-logo-url" className="mb-1 block text-xs font-medium text-gray-600">
                                            URLを直接指定する場合
                                        </label>
                                        <input
                                            id="settings-logo-url"
                                            type="url"
                                            value={branding.logoUrl}
                                            onChange={(event) => onBrandingChange("logoUrl", event.target.value)}
                                            placeholder="https://example.com/logo.png"
                                            className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="settings-primary-color" className="mb-1 block text-sm font-medium">テーマカラー</label>
                                <div className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                                    {BRANDING_COLOR_PRESETS.map((preset) => {
                                        const isSelected = previewColor.toLowerCase() === preset.value.toLowerCase();
                                        return (
                                            <button
                                                key={preset.value}
                                                type="button"
                                                aria-label={`テーマカラー ${preset.name}`}
                                                onClick={() => onBrandingChange("primaryColor", preset.value)}
                                                className={cn(
                                                    "group rounded-2xl border bg-white p-2 text-left transition",
                                                    isSelected
                                                        ? "border-primary ring-2 ring-primary/20"
                                                        : "border-gray-200 hover:border-gray-300"
                                                )}
                                            >
                                                <div
                                                    className="mb-2 h-8 rounded-xl"
                                                    style={{ backgroundColor: preset.value }}
                                                />
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[11px] font-medium text-gray-700">
                                                        {preset.name}
                                                    </span>
                                                    {isSelected && (
                                                        <Check className="h-3.5 w-3.5 text-primary" />
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                    <input
                                        type="color"
                                        aria-label="テーマカラー選択"
                                        value={previewColor}
                                        onChange={(event) => onBrandingChange("primaryColor", event.target.value)}
                                        className="h-11 w-16 rounded-xl border border-gray-200 bg-white p-1"
                                    />
                                    <input
                                        id="settings-primary-color"
                                        type="text"
                                        value={branding.primaryColor}
                                        onChange={(event) => onBrandingChange("primaryColor", event.target.value)}
                                        placeholder="#4F46E5"
                                        className={cn(
                                            "h-10 flex-1 rounded-lg border px-3 text-sm focus:outline-none focus:ring-1",
                                            HEX_COLOR_REGEX.test(branding.primaryColor)
                                                ? "border-gray-200 focus:border-primary focus:ring-primary"
                                                : "border-destructive/50 focus:border-destructive focus:ring-destructive"
                                        )}
                                    />
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    まず上の色見本から選び、細かく調整したいときだけカラーピッカーか HEX を使ってください
                                </p>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                            <p className="mb-3 text-xs font-medium text-gray-500">プレビュー</p>
                            <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                                {branding.logoUrl ? (
                                    <img
                                        src={branding.logoUrl}
                                        alt="customer-app ロゴプレビュー"
                                        className="h-12 w-12 rounded-full object-cover"
                                    />
                                ) : (
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-500">
                                        LOGO
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-gray-900">
                                        {profile.name || "店舗名"}
                                    </div>
                                    <div className="truncate text-xs text-gray-500">
                                        {profile.address || "住所が入ります"}
                                    </div>
                                    <div
                                        className="mt-2 h-1.5 rounded-full"
                                        style={{ backgroundColor: previewColor }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export function BusinessHoursSection({
    businessHours,
    onToggleOpen,
    onTimeChange,
}: {
    businessHours: BusinessHour[];
    onToggleOpen: (index: number, checked: boolean) => void;
    onTimeChange: (index: number, field: "openTime" | "closeTime", value: string) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">営業時間</CardTitle>
                <CardDescription>曜日ごとの営業時間を設定します</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {businessHours.map((item, index) => (
                        <div key={item.day} className="flex items-center gap-4 rounded-lg bg-gray-50 p-3">
                            <div className="w-10 text-center font-medium">{item.day}</div>
                            <label className="flex w-24 items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={item.isOpen}
                                    onChange={(event) => onToggleOpen(index, event.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <span className="text-sm">{item.isOpen ? "営業" : "休業"}</span>
                            </label>
                            {item.isOpen ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="time"
                                        value={item.openTime}
                                        onChange={(event) =>
                                            onTimeChange(index, "openTime", event.target.value)
                                        }
                                        className="h-9 rounded border border-gray-200 px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <span className="text-muted-foreground">〜</span>
                                    <input
                                        type="time"
                                        value={item.closeTime}
                                        onChange={(event) =>
                                            onTimeChange(index, "closeTime", event.target.value)
                                        }
                                        className="h-9 rounded border border-gray-200 px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            ) : (
                                <span className="text-sm text-muted-foreground">定休日</span>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function NotificationSectionCard({
    title,
    icon,
    items,
    notifications,
    onToggle,
}: {
    title: string;
    icon: React.ReactNode;
    items: ReadonlyArray<{
        key: NotificationKey;
        label: string;
        desc: string;
    }>;
    notifications: NotificationSettingsForm;
    onToggle: (key: NotificationKey, checked: boolean) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    {icon}
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {items.map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                        <div>
                            <div className="font-medium">{item.label}</div>
                            <div className="text-sm text-muted-foreground">{item.desc}</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={notifications[item.key]}
                            aria-label={item.label}
                            onChange={(event) => onToggle(item.key, event.target.checked)}
                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

export function NotificationsSection({
    notifications,
    onToggle,
}: {
    notifications: NotificationSettingsForm;
    onToggle: (key: NotificationKey, checked: boolean) => void;
}) {
    return (
        <div className="space-y-6">
            <NotificationSectionCard
                title="メール通知"
                icon={<Mail className="h-5 w-5" />}
                items={EMAIL_NOTIFICATION_ITEMS}
                notifications={notifications}
                onToggle={onToggle}
            />
            <NotificationSectionCard
                title="LINE通知（顧客向け）"
                icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.348 0-.63-.285-.63-.629V9.863c0-.346.282-.631.63-.631h2.016zm-3.855 0c.348 0 .63.285.63.631v3.024c0 .344-.282.629-.63.629-.349 0-.631-.285-.631-.629V10.494c0-.346.282-.631.631-.631zm-2.976 3.024v.63c0 .344-.281.629-.63.629-.348 0-.63-.285-.63-.629v-.63h-1.125v.63c0 .344-.281.629-.63.629-.349 0-.63-.285-.63-.629v-.63H7.764c-.349 0-.63-.285-.63-.629V9.863c0-.346.281-.631.63-.631h4.14c.349 0 .63.285.63.631v2.394h.63v.63zm-2.385-2.024h-1.88v1.395h1.88v-1.395zM4.635 9.863c.349 0 .63.285.63.631v2.394h1.125c.349 0 .63.285.63.63s-.281.629-.63.629H4.635c-.349 0-.631-.285-.631-.629V10.494c0-.346.282-.631.631-.631z" />
                    </svg>
                }
                items={LINE_NOTIFICATION_ITEMS}
                notifications={notifications}
                onToggle={onToggle}
            />
        </div>
    );
}

export function BookingSettingsSection({
    bookingSettings,
    rfmSettings,
    rfmValidationError,
    onBookingChange,
    onRfmScoreChange,
}: {
    bookingSettings: BookingSettingsForm;
    rfmSettings: RfmThresholdSettings;
    rfmValidationError: string | null;
    onBookingChange: (field: keyof BookingSettingsForm, value: number) => void;
    onRfmScoreChange: (axis: RfmAxisKey, score: RfmScoreKey, value: string) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">予約受付設定</CardTitle>
                <CardDescription>予約の受付条件を設定します</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium">予約可能期間</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={bookingSettings.advanceDays}
                                onChange={(event) =>
                                    onBookingChange("advanceDays", Number.parseInt(event.target.value, 10))
                                }
                                className="h-10 w-20 rounded-lg border border-gray-200 px-3 text-center text-sm"
                            />
                            <span className="text-sm text-muted-foreground">日先まで予約可能</span>
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">キャンセル期限</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={bookingSettings.cancelDeadlineHours}
                                onChange={(event) =>
                                    onBookingChange(
                                        "cancelDeadlineHours",
                                        Number.parseInt(event.target.value, 10)
                                    )
                                }
                                className="h-10 w-20 rounded-lg border border-gray-200 px-3 text-center text-sm"
                            />
                            <span className="text-sm text-muted-foreground">時間前まで可能</span>
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">予約枠の間隔</label>
                        <select
                            value={bookingSettings.slotInterval}
                            onChange={(event) =>
                                onBookingChange("slotInterval", Number.parseInt(event.target.value, 10))
                            }
                            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                        >
                            <option value={15}>15分</option>
                            <option value={30}>30分</option>
                            <option value={60}>60分</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-4 rounded-lg border border-gray-200 p-4">
                    <div>
                        <div className="text-base font-semibold">RFM閾値設定</div>
                        <p className="text-sm text-muted-foreground">
                            顧客セグメント判定に使う閾値を設定します（Recencyは小さいほど高スコア）。
                        </p>
                    </div>
                    {rfmValidationError && (
                        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {rfmValidationError}
                        </div>
                    )}
                    {RFM_AXES.map((axis) => (
                        <div key={axis.key} className="space-y-2 rounded-lg bg-gray-50 p-3">
                            <div>
                                <div className="font-medium">{axis.label}</div>
                                <div className="text-xs text-muted-foreground">{axis.rule}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                {(["score5", "score4", "score3", "score2"] as const).map((score) => (
                                    <label key={`${axis.key}-${score}`} className="space-y-1 text-xs">
                                        <span className="text-muted-foreground">{score}</span>
                                        <input
                                            aria-label={`RFM ${axis.key} ${score}`}
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={rfmSettings[axis.key][score]}
                                            onChange={(event) =>
                                                onRfmScoreChange(axis.key, score, event.target.value)
                                            }
                                            className="h-9 w-full rounded border border-gray-200 px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

export function IntegrationsSection({
    integrations,
    lineDirectInputDisabled,
    linePreview,
    linePreviewLoading,
    linePreviewError,
    linePreviewPractitionerId,
    onLineModeChange,
    onLineFieldChange,
    onPreviewRefresh,
    onPreviewPractitionerIdChange,
}: {
    integrations: IntegrationsSettingsForm;
    lineDirectInputDisabled: boolean;
    linePreview: LineResolvePreviewResponse | null;
    linePreviewLoading: boolean;
    linePreviewError: string | null;
    linePreviewPractitionerId: string;
    onLineModeChange: (mode: LineMode) => void;
    onLineFieldChange: (field: EditableLineField, value: string) => void;
    onPreviewRefresh: () => void;
    onPreviewPractitionerIdChange: (value: string) => void;
}) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">LINE連携</CardTitle>
                    <CardDescription>LINE公式アカウントとの連携設定</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4 rounded-lg bg-gray-50 p-4">
                        <div>
                            <label className="text-sm font-medium">LINE運用モード</label>
                            <div className="mt-2 grid gap-2 md:grid-cols-3">
                                {LINE_MODE_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => onLineModeChange(option.value)}
                                        className={cn(
                                            "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                                            integrations.lineMode === option.value
                                                ? "border-primary bg-red-50 text-red-600"
                                                : "border-gray-200 bg-white text-gray-600"
                                        )}
                                    >
                                        <div className="font-semibold">{option.title}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {option.description}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                                施術者モードでは「スタッフ設定→LINE」が優先され、未設定時は店舗/共通設定にフォールバックします。
                            </p>
                            {integrations.lineMode === "practitioner" && (
                                <p className="mt-2 text-xs text-amber-700">
                                    施術者モードではこの画面の LIFF/Channel 入力は編集できません。施術者ごとの設定は{" "}
                                    <Link href="/staff" className="underline">
                                        スタッフ管理
                                    </Link>{" "}
                                    で更新してください。
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <div
                                className={cn(
                                    "h-3 w-3 rounded-full",
                                    integrations.lineConnected ? "bg-green-500" : "bg-gray-300"
                                )}
                            />
                            <div>
                                <div className="font-medium">
                                    {integrations.lineConnected ? "接続済み" : "未接続"}
                                </div>
                                {integrations.lineConnected && (
                                    <div className="text-sm text-muted-foreground">
                                        Channel ID: {integrations.lineChannelId}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid gap-3">
                            <div>
                                <label className="text-sm font-medium">Channel ID</label>
                                <input
                                    value={integrations.lineChannelId}
                                    onChange={(event) =>
                                        onLineFieldChange("lineChannelId", event.target.value)
                                    }
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="1234567890"
                                    readOnly={lineDirectInputDisabled}
                                    disabled={lineDirectInputDisabled}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">LIFF ID</label>
                                <input
                                    value={integrations.lineLiffId}
                                    onChange={(event) =>
                                        onLineFieldChange("lineLiffId", event.target.value)
                                    }
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="xxxxxxxxxxxxxxxx"
                                    readOnly={lineDirectInputDisabled}
                                    disabled={lineDirectInputDisabled}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Channel Access Token</label>
                                <input
                                    type="password"
                                    value={integrations.lineChannelAccessToken}
                                    onChange={(event) =>
                                        onLineFieldChange(
                                            "lineChannelAccessToken",
                                            event.target.value
                                        )
                                    }
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="アクセストークン"
                                    readOnly={lineDirectInputDisabled}
                                    disabled={lineDirectInputDisabled}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">Channel Secret</label>
                                <input
                                    type="password"
                                    value={integrations.lineChannelSecret}
                                    onChange={(event) =>
                                        onLineFieldChange("lineChannelSecret", event.target.value)
                                    }
                                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="シークレット"
                                    readOnly={lineDirectInputDisabled}
                                    disabled={lineDirectInputDisabled}
                                />
                            </div>
                        </div>
                        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold">解決結果プレビュー</div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={onPreviewRefresh}
                                    disabled={linePreviewLoading}
                                >
                                    {linePreviewLoading ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        "再取得"
                                    )}
                                </Button>
                            </div>
                            <div className="mb-2">
                                <label className="text-xs text-muted-foreground">
                                    施術者ID（任意）
                                </label>
                                <input
                                    value={linePreviewPractitionerId}
                                    onChange={(event) =>
                                        onPreviewPractitionerIdChange(event.target.value.trim())
                                    }
                                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
                                    placeholder="UUIDを指定すると施術者指定でプレビュー"
                                />
                            </div>
                            {linePreviewError && (
                                <p className="text-xs text-red-600">{linePreviewError}</p>
                            )}
                            {linePreview && (
                                <div className="space-y-1 text-xs text-gray-600">
                                    <div>
                                        mode: <span className="font-mono">{linePreview.mode}</span>
                                    </div>
                                    <div>
                                        source:{" "}
                                        <span className="font-mono">{linePreview.source}</span>
                                    </div>
                                    <div>
                                        liffId:{" "}
                                        <span className="font-mono">
                                            {linePreview.liffId || "(empty)"}
                                        </span>
                                    </div>
                                    <div>
                                        channelId:{" "}
                                        <span className="font-mono">
                                            {linePreview.channelId || "(empty)"}
                                        </span>
                                    </div>
                                    <div>
                                        storeId:{" "}
                                        <span className="font-mono">
                                            {linePreview.storeId || "(none)"}
                                        </span>
                                    </div>
                                    <div>
                                        practitionerId:{" "}
                                        <span className="font-mono">
                                            {linePreview.practitionerId || "(none)"}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">その他の連携</CardTitle>
                    <CardDescription>
                        Googleカレンダー連携やジョブ実行は専用画面に分離しました
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                        設定画面では店舗設定とLINE設定に絞り、他の連携管理は専用ページから行います。
                    </p>
                    <Button variant="outline" asChild>
                        <Link href="/integrations">連携管理を開く</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

export function SaveActions({
    saveMessage,
    saving,
    saveDisabled = false,
    onSave,
}: {
    saveMessage: SaveMessage | null;
    saving: boolean;
    saveDisabled?: boolean;
    onSave: () => void;
}) {
    return (
        <div className="flex max-w-4xl items-center justify-end gap-4">
            {saveMessage && (
                <div
                    className={cn(
                        "rounded-lg px-4 py-2 text-sm",
                        saveMessage.type === "success"
                            ? "bg-green-50 text-green-600"
                            : "bg-red-50 text-red-600"
                    )}
                >
                    {saveMessage.text}
                </div>
            )}
            <Button size="lg" onClick={onSave} disabled={saving || saveDisabled}>
                {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <Save className="mr-2 h-4 w-4" />
                )}
                {saving ? "保存中..." : "設定を保存"}
            </Button>
        </div>
    );
}
