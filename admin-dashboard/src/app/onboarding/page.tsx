"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    googleCalendarApi,
    onboardingApi,
    settingsApi,
} from "@/lib/api";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface WizardState {
    tenantName: string;
    storeName: string;
    timezone: string;
    address: string;
    phone: string;
    advanceBookingDays: number;
    cancelDeadlineHours: number;
    slotDuration: number;
    menuName: string;
    menuCategory: string;
    menuPrice: number;
    menuDuration: number;
    practitionerName: string;
}

const initialState: WizardState = {
    tenantName: "",
    storeName: "",
    timezone: "Asia/Tokyo",
    address: "",
    phone: "",
    advanceBookingDays: 30,
    cancelDeadlineHours: 24,
    slotDuration: 30,
    menuName: "カット",
    menuCategory: "カット",
    menuPrice: 5500,
    menuDuration: 60,
    practitionerName: "オーナー",
};

const steps: Array<{ id: WizardStep; title: string }> = [
    { id: 1, title: "テナント基本情報" },
    { id: 2, title: "店舗情報" },
    { id: 3, title: "予約ポリシー" },
    { id: 4, title: "初期メニュー/スタッフ" },
    { id: 5, title: "Google連携 / LINE設定" },
    { id: 6, title: "完了確認" },
];

export default function OnboardingPage() {
    const router = useRouter();
    const [step, setStep] = useState<WizardStep>(1);
    const [state, setState] = useState<WizardState>(initialState);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [googleStatusText, setGoogleStatusText] = useState("未連携");
    const [googleConnected, setGoogleConnected] = useState(false);

    const refreshGoogleStatus = useCallback(async () => {
        const googleStatus = await googleCalendarApi.getStatus();
        if (!googleStatus.success) {
            return false;
        }
        const connected = Boolean((googleStatus.data as { connected?: boolean } | undefined)?.connected);
        setGoogleConnected(connected);
        setGoogleStatusText(connected ? "連携済み" : "未連携");
        return connected;
    }, []);

    const handleGoogleCallbackResult = useCallback(async (connected: boolean) => {
        const latestConnected = await refreshGoogleStatus();
        if (connected || latestConnected) {
            setNotice("Google連携が完了しました。");
            setError("");
            return;
        }
        setNotice("");
        setError("Google連携に失敗しました。もう一度お試しください。");
    }, [refreshGoogleStatus]);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const statusResponse = await onboardingApi.getStatus();
                if (!statusResponse.success) {
                    throw new Error(statusResponse.error?.message || "オンボーディング状態の取得に失敗しました");
                }
                if (statusResponse.data?.completed) {
                    router.replace("/");
                    return;
                }

                const savedPayload = statusResponse.data?.onboardingPayload as (Partial<WizardState> & { step?: number }) | undefined;
                if (savedPayload && mounted) {
                    setState((prev) => ({
                        ...prev,
                        ...savedPayload,
                    }));
                    if (savedPayload.step && savedPayload.step >= 1 && savedPayload.step <= 6) {
                        setStep(savedPayload.step as WizardStep);
                    }
                }

                const settingsResponse = await settingsApi.get();
                const tenant = (settingsResponse.data as any)?.tenant;
                const store = (settingsResponse.data as any)?.store;

                if (mounted) {
                    setState((prev) => ({
                        ...prev,
                        tenantName: tenant?.name || prev.tenantName,
                        storeName: store?.name || prev.storeName,
                        timezone: store?.timezone || prev.timezone,
                        address: store?.address || prev.address,
                        phone: store?.phone || prev.phone,
                        advanceBookingDays: store?.advanceBookingDays || prev.advanceBookingDays,
                        cancelDeadlineHours: store?.cancelDeadlineHours || prev.cancelDeadlineHours,
                        slotDuration: store?.slotDuration || prev.slotDuration,
                    }));
                }

                if (mounted) {
                    await refreshGoogleStatus();
                }
            } catch (err: any) {
                if (mounted) {
                    setError(err?.message || "初期化に失敗しました");
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        load();
        return () => {
            mounted = false;
        };
    }, [refreshGoogleStatus, router]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const queryStatus = params.get("googleCalendar");
        if (queryStatus === "connected" || queryStatus === "failed") {
            const connected = queryStatus === "connected";
            handleGoogleCallbackResult(queryStatus === "connected").catch(() => {
                // noop
            });

            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage({
                        type: "reserve:google-oauth-result",
                        connected,
                    }, "*");
                    window.setTimeout(() => window.close(), 200);
                } catch {
                    // noop
                }
            }

            params.delete("googleCalendar");
            params.delete("tenantId");
            const next = params.toString();
            const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
            window.history.replaceState({}, "", nextUrl);
        }

        const handleFocus = () => {
            refreshGoogleStatus().catch(() => {
                // noop: keep previous status if refresh fails.
            });
        };

        const handleMessage = (event: MessageEvent) => {
            const payload = event.data as {
                type?: string;
                connected?: boolean;
            };
            if (payload?.type !== "reserve:google-oauth-result") {
                return;
            }
            handleGoogleCallbackResult(Boolean(payload.connected)).catch(() => {
                // noop
            });
        };

        window.addEventListener("focus", handleFocus);
        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("focus", handleFocus);
            window.removeEventListener("message", handleMessage);
        };
    }, [handleGoogleCallbackResult, refreshGoogleStatus]);

    const saveProgress = async (
        nextStep: WizardStep,
        options?: {
            applySetupPayload?: Record<string, unknown>;
        }
    ) => {
        const payload = { ...state, step: nextStep };
        await onboardingApi.updateStatus({
            status: "in_progress",
            onboardingPayload: payload,
            applySetup: Boolean(options?.applySetupPayload),
            applySetupPayload: options?.applySetupPayload,
        });
        setStep(nextStep);
    };

    const buildApplySetupPayload = (currentStep: WizardStep): Record<string, unknown> | undefined => {
        if (currentStep === 2) {
            return {
                tenantName: state.tenantName,
                storeName: state.storeName,
                timezone: state.timezone,
                address: state.address,
                phone: state.phone,
            };
        }

        if (currentStep === 3) {
            return {
                slotDuration: state.slotDuration,
                advanceBookingDays: state.advanceBookingDays,
                cancelDeadlineHours: state.cancelDeadlineHours,
            };
        }

        if (currentStep === 4) {
            return {
                menuName: state.menuName,
                menuCategory: state.menuCategory,
                menuPrice: state.menuPrice,
                menuDuration: state.menuDuration,
                practitionerName: state.practitionerName,
            };
        }

        return undefined;
    };

    const handleNext = async () => {
        if (step === 6) return;
        if (step === 5 && !googleConnected) {
            setError("Google Calendar 連携が完了してから次へ進んでください。");
            return;
        }

        setSubmitting(true);
        setError("");
        try {
            const nextStep = (step + 1) as WizardStep;
            await saveProgress(nextStep, {
                applySetupPayload: buildApplySetupPayload(step),
            });
        } catch (err: any) {
            setError(err?.message || "保存に失敗しました");
        } finally {
            setSubmitting(false);
        }
    };

    const handleBack = () => {
        if (step === 1) return;
        setStep((step - 1) as WizardStep);
    };

    const handleGoogleConnect = async () => {
        setSubmitting(true);
        setError("");
        try {
            const redirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
            const response = await googleCalendarApi.startOAuth(redirectTo);
            if (!response.success || !response.data?.authUrl) {
                throw new Error(response.error?.message || "Google OAuth開始に失敗しました");
            }
            const popup = window.open(
                response.data.authUrl,
                "reserve-google-oauth",
                "popup,width=620,height=780"
            );
            if (!popup) {
                window.location.href = response.data.authUrl;
            }
        } catch (err: any) {
            setError(err?.message || "Google OAuth開始に失敗しました");
        } finally {
            setSubmitting(false);
        }
    };

    const completeOnboarding = async () => {
        if (!googleConnected) {
            setError("Google Calendar 連携が完了していないため、オンボーディングを完了できません。");
            return;
        }

        setSubmitting(true);
        setError("");
        try {
            const response = await onboardingApi.updateStatus({
                status: "completed",
                onboardingPayload: { ...state, step: 6 },
            });
            if (!response.success) {
                throw new Error(response.error?.message || "オンボーディング完了処理に失敗しました");
            }
            router.replace("/");
        } catch (err: any) {
            setError(err?.message || "オンボーディング完了処理に失敗しました");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
                <h1 className="text-2xl font-bold text-gray-900">初期設定ウィザード</h1>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                {steps.map((item) => (
                    <div
                        key={item.id}
                        className={`rounded-xl border px-3 py-2 text-xs md:text-sm ${item.id === step ? "border-primary bg-primary/5 text-primary" : "border-gray-200 bg-white text-gray-500"}`}
                    >
                        <div className="font-semibold">Step {item.id}</div>
                        <div>{item.title}</div>
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6 space-y-4">
                {step === 1 && (
                    <>
                        <h2 className="text-lg font-semibold">テナント基本情報</h2>
                        <label className="block text-sm">サロン名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.tenantName} onChange={(e) => setState((prev) => ({ ...prev, tenantName: e.target.value }))} />
                        <p className="text-xs text-gray-500">URL識別子（tenantKey）はシステムで自動発行・管理されます。</p>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h2 className="text-lg font-semibold">店舗情報</h2>
                        <label className="block text-sm">店舗名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.storeName} onChange={(e) => setState((prev) => ({ ...prev, storeName: e.target.value }))} />
                        <label className="block text-sm">住所</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.address} onChange={(e) => setState((prev) => ({ ...prev, address: e.target.value }))} />
                        <label className="block text-sm">電話</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.phone} onChange={(e) => setState((prev) => ({ ...prev, phone: e.target.value }))} />
                        <label className="block text-sm">タイムゾーン</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.timezone} onChange={(e) => setState((prev) => ({ ...prev, timezone: e.target.value }))} />
                    </>
                )}

                {step === 3 && (
                    <>
                        <h2 className="text-lg font-semibold">予約ポリシー</h2>
                        <label className="block text-sm">受付期間（日）</label>
                        <input type="number" className="w-full border rounded-lg px-3 py-2" value={state.advanceBookingDays} onChange={(e) => setState((prev) => ({ ...prev, advanceBookingDays: Number(e.target.value) || 30 }))} />
                        <label className="block text-sm">キャンセル期限（時間）</label>
                        <input type="number" className="w-full border rounded-lg px-3 py-2" value={state.cancelDeadlineHours} onChange={(e) => setState((prev) => ({ ...prev, cancelDeadlineHours: Number(e.target.value) || 24 }))} />
                        <label className="block text-sm">スロット間隔（分）</label>
                        <input type="number" className="w-full border rounded-lg px-3 py-2" value={state.slotDuration} onChange={(e) => setState((prev) => ({ ...prev, slotDuration: Number(e.target.value) || 30 }))} />
                    </>
                )}

                {step === 4 && (
                    <>
                        <h2 className="text-lg font-semibold">初期メニュー / スタッフ</h2>
                        <label className="block text-sm">初期メニュー名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.menuName} onChange={(e) => setState((prev) => ({ ...prev, menuName: e.target.value }))} />
                        <label className="block text-sm">カテゴリ</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.menuCategory} onChange={(e) => setState((prev) => ({ ...prev, menuCategory: e.target.value }))} />
                        <label className="block text-sm">料金（円）</label>
                        <input type="number" className="w-full border rounded-lg px-3 py-2" value={state.menuPrice} onChange={(e) => setState((prev) => ({ ...prev, menuPrice: Number(e.target.value) || 0 }))} />
                        <label className="block text-sm">施術時間（分）</label>
                        <input type="number" className="w-full border rounded-lg px-3 py-2" value={state.menuDuration} onChange={(e) => setState((prev) => ({ ...prev, menuDuration: Number(e.target.value) || 60 }))} />
                        <label className="block text-sm">初期スタッフ名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.practitionerName} onChange={(e) => setState((prev) => ({ ...prev, practitionerName: e.target.value }))} />
                    </>
                )}

                {step === 5 && (
                    <>
                        <h2 className="text-lg font-semibold">Google連携（必須） / LINE連携（任意）</h2>
                        <div className="rounded-lg border border-gray-200 p-3">
                            <p className="text-sm">Google Calendar 連携状態: <span className="font-semibold">{googleStatusText}</span></p>
                            <Button className="mt-3" onClick={handleGoogleConnect} disabled={submitting}>
                                Google連携を開始
                            </Button>
                        </div>
                        <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
                            LINE連携は後から設定可能です。今回はスキップできます。
                        </div>
                        {!googleConnected && (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                                Google連携が必須です。連携完了後に「次へ」が有効になります。
                            </div>
                        )}
                    </>
                )}

                {step === 6 && (
                    <>
                        <h2 className="text-lg font-semibold">完了確認</h2>
                        <p className="text-sm text-gray-600">初期設定を完了すると管理画面トップへ遷移します。</p>
                        <div className="rounded-lg border border-gray-200 p-3 text-sm">
                            <p>テナント: {state.tenantName}</p>
                            <p>店舗: {state.storeName}</p>
                            <p>予約ポリシー: {state.advanceBookingDays}日先 / {state.cancelDeadlineHours}時間前締切</p>
                            <p>Google連携: {googleConnected ? "連携済み" : "未連携"}</p>
                        </div>
                        <Button onClick={completeOnboarding} disabled={submitting}>
                            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />完了中...</> : "オンボーディングを完了"}
                        </Button>
                    </>
                )}

                {error && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
                        {notice}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between">
                <Button type="button" variant="outline" onClick={handleBack} disabled={step === 1 || submitting}>
                    戻る
                </Button>
                {step < 6 && (
                    <Button type="button" onClick={handleNext} disabled={submitting || (step === 5 && !googleConnected)}>
                        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</> : "次へ"}
                    </Button>
                )}
            </div>
        </div>
    );
}
