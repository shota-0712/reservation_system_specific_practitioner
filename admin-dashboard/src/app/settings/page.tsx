"use client";

import { useState, useEffect } from "react";
import { Save, Upload, ExternalLink, Bell, Shield, CreditCard, Mail, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { settingsApi } from "@/lib/api";

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

const tabs = [
    { id: "general", name: "店舗情報", icon: ExternalLink },
    { id: "hours", name: "営業時間", icon: Clock },
    { id: "notifications", name: "通知設定", icon: Bell },
    { id: "booking", name: "予約設定", icon: CreditCard },
    { id: "integrations", name: "連携設定", icon: Shield },
];

interface SettingsResponse {
    tenant: {
        id: string;
        name: string;
        lineConfig?: {
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
        businessHours?: Record<string, { isOpen: boolean; openTime?: string; closeTime?: string }>;
        regularHolidays?: number[];
        slotDuration?: number;
        advanceBookingDays?: number;
        cancelDeadlineHours?: number;
    };
}

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("general");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [storeName, setStoreName] = useState("");
    const [storePhone, setStorePhone] = useState("");
    const [storeAddress, setStoreAddress] = useState("");
    const [storeEmail, setStoreEmail] = useState("");
    const [storeUrl, setStoreUrl] = useState("");

    const [businessHours, setBusinessHours] = useState(
        DAYS.map((day, i) => ({
            day,
            dayOfWeek: i,
            isOpen: i !== 0,
            openTime: "10:00",
            closeTime: "20:00",
        }))
    );

    const [notifications, setNotifications] = useState({
        emailNewReservation: true,
        emailCancellation: true,
        emailDailyReport: true,
        lineReminder: true,
        lineConfirmation: true,
        lineReview: true,
        pushNewReservation: true,
        pushCancellation: true,
    });

    const [bookingSettings, setBookingSettings] = useState({
        advanceDays: 30,
        minAdvanceHours: 2,
        cancelDeadlineHours: 24,
        autoConfirm: true,
        allowSameDay: true,
        slotInterval: 30,
        maxConcurrent: 3,
    });

    const [integrations, setIntegrations] = useState({
        lineConnected: false,
        lineChannelId: "",
        lineLiffId: "",
        lineChannelAccessToken: "",
        lineChannelSecret: "",
        salonboardConnected: false,
        salonboardId: "",
        googleCalendarConnected: false,
        googleCalendarId: "",
    });

    // 設定を取得
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const response = await settingsApi.get();
                if (response.success && response.data) {
                    const data = response.data as SettingsResponse;
                    setStoreName(data.store?.name || data.tenant?.name || "");
                    setStorePhone(data.store?.phone || "");
                    setStoreAddress(data.store?.address || "");
                    setStoreEmail(data.store?.email || "");
                    setStoreUrl("");

                    if (data.store?.businessHours) {
                        setBusinessHours(
                            DAYS.map((day, i) => {
                                const found = data.store?.businessHours?.[String(i)];
                                return {
                                    day,
                                    dayOfWeek: i,
                                    isOpen: found?.isOpen ?? i !== 0,
                                    openTime: found?.openTime || "10:00",
                                    closeTime: found?.closeTime || "20:00",
                                };
                            })
                        );
                    }

                    setBookingSettings(prev => ({
                        ...prev,
                        advanceDays: data.store?.advanceBookingDays ?? prev.advanceDays,
                        cancelDeadlineHours: data.store?.cancelDeadlineHours ?? prev.cancelDeadlineHours,
                        slotInterval: data.store?.slotDuration ?? prev.slotInterval,
                    }));

                    if (data.tenant?.lineConfig) {
                        setIntegrations(prev => ({
                            ...prev,
                            lineConnected: !!data.tenant.lineConfig?.channelId,
                            lineChannelId: data.tenant.lineConfig?.channelId || "",
                            lineLiffId: data.tenant.lineConfig?.liffId || "",
                        }));
                    }
                }
            } catch (error) {
                console.error('Failed to fetch settings:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchSettings();
    }, []);

    // 設定を保存
    const handleSave = async () => {
        setSaving(true);
        setSaveMessage(null);

        try {
            // プロフィール設定を保存
            if (activeTab === "general") {
                const profileResult = await settingsApi.updateProfile({
                    name: storeName,
                    phone: storePhone,
                    address: storeAddress,
                    email: storeEmail,
                });
                if (!profileResult.success) {
                    throw new Error(profileResult.error?.message || 'Failed to save profile');
                }
            }

            // 営業時間・予約設定を保存
            if (activeTab === "hours" || activeTab === "booking") {
                const businessHoursRecord = businessHours.reduce<Record<string, any>>((acc, h) => {
                    acc[String(h.dayOfWeek)] = {
                        isOpen: h.isOpen,
                        openTime: h.openTime,
                        closeTime: h.closeTime,
                    };
                    return acc;
                }, {});
                const regularHolidays = businessHours.filter(h => !h.isOpen).map(h => h.dayOfWeek);

                const businessResult = await settingsApi.updateBusiness({
                    businessHours: businessHoursRecord,
                    regularHolidays,
                    slotDuration: bookingSettings.slotInterval,
                    advanceBookingDays: bookingSettings.advanceDays,
                    cancelDeadlineHours: bookingSettings.cancelDeadlineHours,
                });
                if (!businessResult.success) {
                    throw new Error(businessResult.error?.message || 'Failed to save business settings');
                }
            }

            // LINE連携を保存
            if (activeTab === "integrations") {
                const lineResult = await settingsApi.updateLine({
                    channelId: integrations.lineChannelId || undefined,
                    liffId: integrations.lineLiffId || undefined,
                    channelAccessToken: integrations.lineChannelAccessToken || undefined,
                    channelSecret: integrations.lineChannelSecret || undefined,
                });
                if (!lineResult.success) {
                    throw new Error(lineResult.error?.message || 'Failed to save LINE settings');
                }
            }

            setSaveMessage({ type: 'success', text: '設定を保存しました' });
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error: any) {
            console.error('Failed to save settings:', error);
            setSaveMessage({ type: 'error', text: error.message || '保存に失敗しました' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight">設定</h1>
                <p className="text-muted-foreground">
                    店舗の各種設定を管理します
                </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b pb-2 overflow-x-auto">
                {tabs.map((tab) => (
                    <Button
                        key={tab.id}
                        variant={activeTab === tab.id ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab(tab.id)}
                        className="flex items-center gap-2"
                    >
                        <tab.icon className="h-4 w-4" />
                        {tab.name}
                    </Button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="max-w-4xl">
                {/* General Settings */}
                {activeTab === "general" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">店舗基本情報</CardTitle>
                            <CardDescription>店舗の基本情報を設定します</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Logo Upload */}
                            <div>
                                <label className="block text-sm font-medium mb-2">店舗ロゴ</label>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 border-2 border-dashed">
                                        <Upload className="h-8 w-8" />
                                    </div>
                                    <Button variant="outline" size="sm">
                                        画像をアップロード
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium mb-1">店舗名</label>
                                    <input
                                        type="text"
                                        value={storeName}
                                        onChange={(e) => setStoreName(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">電話番号</label>
                                    <input
                                        type="tel"
                                        value={storePhone}
                                        onChange={(e) => setStorePhone(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">住所</label>
                                <input
                                    type="text"
                                    value={storeAddress}
                                    onChange={(e) => setStoreAddress(e.target.value)}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium mb-1">メールアドレス</label>
                                    <input
                                        type="email"
                                        value={storeEmail}
                                        onChange={(e) => setStoreEmail(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Webサイト</label>
                                    <input
                                        type="url"
                                        value={storeUrl}
                                        onChange={(e) => setStoreUrl(e.target.value)}
                                        className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Business Hours */}
                {activeTab === "hours" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">営業時間</CardTitle>
                            <CardDescription>曜日ごとの営業時間を設定します</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {businessHours.map((item, index) => (
                                    <div key={item.day} className="flex items-center gap-4 p-3 rounded-lg bg-gray-50">
                                        <div className="w-10 font-medium text-center">{item.day}</div>
                                        <label className="flex items-center gap-2 w-24">
                                            <input
                                                type="checkbox"
                                                checked={item.isOpen}
                                                onChange={(e) => {
                                                    const updated = [...businessHours];
                                                    updated[index].isOpen = e.target.checked;
                                                    setBusinessHours(updated);
                                                }}
                                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                            <span className="text-sm">{item.isOpen ? "営業" : "休業"}</span>
                                        </label>
                                        {item.isOpen ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    value={item.openTime}
                                                    onChange={(e) => {
                                                        const updated = [...businessHours];
                                                        updated[index].openTime = e.target.value;
                                                        setBusinessHours(updated);
                                                    }}
                                                    className="h-9 rounded border border-gray-200 px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <span className="text-muted-foreground">〜</span>
                                                <input
                                                    type="time"
                                                    value={item.closeTime}
                                                    onChange={(e) => {
                                                        const updated = [...businessHours];
                                                        updated[index].closeTime = e.target.value;
                                                        setBusinessHours(updated);
                                                    }}
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
                )}

                {/* Notifications */}
                {activeTab === "notifications" && (
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Mail className="h-5 w-5" />
                                    メール通知
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {[
                                    { key: "emailNewReservation", label: "新規予約通知", desc: "新しい予約が入った時" },
                                    { key: "emailCancellation", label: "キャンセル通知", desc: "予約がキャンセルされた時" },
                                    { key: "emailDailyReport", label: "日次レポート", desc: "毎日の予約状況サマリー" },
                                ].map((item) => (
                                    <div key={item.key} className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium">{item.label}</div>
                                            <div className="text-sm text-muted-foreground">{item.desc}</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={notifications[item.key as keyof typeof notifications]}
                                            onChange={(e) =>
                                                setNotifications({ ...notifications, [item.key]: e.target.checked })
                                            }
                                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.348 0-.63-.285-.63-.629V9.863c0-.346.282-.631.63-.631h2.016zm-3.855 0c.348 0 .63.285.63.631v3.024c0 .344-.282.629-.63.629-.349 0-.631-.285-.631-.629V10.494c0-.346.282-.631.631-.631zm-2.976 3.024v.63c0 .344-.281.629-.63.629-.348 0-.63-.285-.63-.629v-.63h-1.125v.63c0 .344-.281.629-.63.629-.349 0-.63-.285-.63-.629v-.63H7.764c-.349 0-.63-.285-.63-.629V9.863c0-.346.281-.631.63-.631h4.14c.349 0 .63.285.63.631v2.394h.63v.63zm-2.385-2.024h-1.88v1.395h1.88v-1.395zM4.635 9.863c.349 0 .63.285.63.631v2.394h1.125c.349 0 .63.285.63.63s-.281.629-.63.629H4.635c-.349 0-.631-.285-.631-.629V10.494c0-.346.282-.631.631-.631z" />
                                    </svg>
                                    LINE通知（顧客向け）
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {[
                                    { key: "lineConfirmation", label: "予約確認メッセージ", desc: "予約確定時に自動送信" },
                                    { key: "lineReminder", label: "リマインダー", desc: "予約前日に自動送信" },
                                    { key: "lineReview", label: "レビュー依頼", desc: "来店後にレビュー依頼を送信" },
                                ].map((item) => (
                                    <div key={item.key} className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium">{item.label}</div>
                                            <div className="text-sm text-muted-foreground">{item.desc}</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={notifications[item.key as keyof typeof notifications]}
                                            onChange={(e) =>
                                                setNotifications({ ...notifications, [item.key]: e.target.checked })
                                            }
                                            className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Booking Settings */}
                {activeTab === "booking" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">予約受付設定</CardTitle>
                            <CardDescription>予約の受付条件を設定します</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <div>
                                    <label className="block text-sm font-medium mb-1">予約可能期間</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={bookingSettings.advanceDays}
                                            onChange={(e) =>
                                                setBookingSettings({ ...bookingSettings, advanceDays: parseInt(e.target.value) })
                                            }
                                            className="w-20 h-10 rounded-lg border border-gray-200 px-3 text-sm text-center"
                                        />
                                        <span className="text-sm text-muted-foreground">日先まで予約可能</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">最短予約時間</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={bookingSettings.minAdvanceHours}
                                            onChange={(e) =>
                                                setBookingSettings({ ...bookingSettings, minAdvanceHours: parseInt(e.target.value) })
                                            }
                                            className="w-20 h-10 rounded-lg border border-gray-200 px-3 text-sm text-center"
                                        />
                                        <span className="text-sm text-muted-foreground">時間後から受付</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">キャンセル期限</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={bookingSettings.cancelDeadlineHours}
                                            onChange={(e) =>
                                                setBookingSettings({ ...bookingSettings, cancelDeadlineHours: parseInt(e.target.value) })
                                            }
                                            className="w-20 h-10 rounded-lg border border-gray-200 px-3 text-sm text-center"
                                        />
                                        <span className="text-sm text-muted-foreground">時間前まで可能</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">予約枠の間隔</label>
                                    <select
                                        value={bookingSettings.slotInterval}
                                        onChange={(e) =>
                                            setBookingSettings({ ...bookingSettings, slotInterval: parseInt(e.target.value) })
                                        }
                                        className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                    >
                                        <option value={15}>15分</option>
                                        <option value={30}>30分</option>
                                        <option value={60}>60分</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium">自動承認</div>
                                        <div className="text-sm text-muted-foreground">予約を自動的に確定する</div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={bookingSettings.autoConfirm}
                                        onChange={(e) =>
                                            setBookingSettings({ ...bookingSettings, autoConfirm: e.target.checked })
                                        }
                                        className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-medium">当日予約</div>
                                        <div className="text-sm text-muted-foreground">当日の予約を受け付ける</div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={bookingSettings.allowSameDay}
                                        onChange={(e) =>
                                            setBookingSettings({ ...bookingSettings, allowSameDay: e.target.checked })
                                        }
                                        className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Integrations */}
                {activeTab === "integrations" && (
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">LINE連携</CardTitle>
                                <CardDescription>LINE公式アカウントとの連携設定</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-3 h-3 rounded-full",
                                            integrations.lineConnected ? "bg-green-500" : "bg-gray-300"
                                        )} />
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
                                                onChange={(e) => setIntegrations(prev => ({ ...prev, lineChannelId: e.target.value }))}
                                                className="mt-1 w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                                placeholder="1234567890"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium">LIFF ID</label>
                                            <input
                                                value={integrations.lineLiffId}
                                                onChange={(e) => setIntegrations(prev => ({ ...prev, lineLiffId: e.target.value }))}
                                                className="mt-1 w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                                placeholder="xxxxxxxxxxxxxxxx"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium">Channel Access Token</label>
                                            <input
                                                type="password"
                                                value={integrations.lineChannelAccessToken}
                                                onChange={(e) => setIntegrations(prev => ({ ...prev, lineChannelAccessToken: e.target.value }))}
                                                className="mt-1 w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                                placeholder="アクセストークン"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium">Channel Secret</label>
                                            <input
                                                type="password"
                                                value={integrations.lineChannelSecret}
                                                onChange={(e) => setIntegrations(prev => ({ ...prev, lineChannelSecret: e.target.value }))}
                                                className="mt-1 w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                                placeholder="シークレット"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">サロンボード連携</CardTitle>
                                <CardDescription>ホットペッパーのサロンボードと同期</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-3 h-3 rounded-full",
                                            integrations.salonboardConnected ? "bg-green-500" : "bg-gray-300"
                                        )} />
                                        <div>
                                            <div className="font-medium">
                                                {integrations.salonboardConnected ? "接続済み" : "未接続"}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                予約の自動同期が可能になります
                                            </div>
                                        </div>
                                    </div>
                                    <Button variant={integrations.salonboardConnected ? "outline" : "default"}>
                                        {integrations.salonboardConnected ? "設定変更" : "連携する"}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Googleカレンダー連携</CardTitle>
                                <CardDescription>予約をGoogleカレンダーに自動追加</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-3 h-3 rounded-full",
                                            integrations.googleCalendarConnected ? "bg-green-500" : "bg-gray-300"
                                        )} />
                                        <div>
                                            <div className="font-medium">
                                                {integrations.googleCalendarConnected ? "接続済み" : "未接続"}
                                            </div>
                                            {integrations.googleCalendarConnected && (
                                                <div className="text-sm text-muted-foreground">
                                                    {integrations.googleCalendarId}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <Button variant={integrations.googleCalendarConnected ? "outline" : "default"}>
                                        {integrations.googleCalendarConnected ? "設定変更" : "連携する"}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end gap-4 max-w-4xl">
                {saveMessage && (
                    <div className={cn(
                        "text-sm px-4 py-2 rounded-lg",
                        saveMessage.type === 'success' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    )}>
                        {saveMessage.text}
                    </div>
                )}
                <Button size="lg" onClick={handleSave} disabled={saving}>
                    {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="mr-2 h-4 w-4" />
                    )}
                    {saving ? "保存中..." : "設定を保存"}
                </Button>
            </div>
        </div>
    );
}
