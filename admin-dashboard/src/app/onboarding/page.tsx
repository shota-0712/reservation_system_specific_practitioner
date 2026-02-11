"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    getTenantKey,
    googleCalendarApi,
    menusApi,
    onboardingApi,
    practitionersApi,
    settingsApi,
    storesApi,
} from "@/lib/api";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

interface WizardState {
    tenantName: string;
    slug: string;
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
    slug: "",
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
    const [googleStatusText, setGoogleStatusText] = useState("未連携");

    const tenantKey = useMemo(() => getTenantKey(), []);

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
                        slug: tenant?.slug || prev.slug,
                        storeName: store?.name || prev.storeName,
                        timezone: store?.timezone || prev.timezone,
                        address: store?.address || prev.address,
                        phone: store?.phone || prev.phone,
                        advanceBookingDays: store?.advanceBookingDays || prev.advanceBookingDays,
                        cancelDeadlineHours: store?.cancelDeadlineHours || prev.cancelDeadlineHours,
                        slotDuration: store?.slotDuration || prev.slotDuration,
                    }));
                }

                const googleStatus = await googleCalendarApi.getStatus();
                if (mounted && googleStatus.success) {
                    const connected = Boolean((googleStatus.data as { connected?: boolean } | undefined)?.connected);
                    setGoogleStatusText(connected ? "連携済み" : "未連携");
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
    }, [router]);

    const saveProgress = async (nextStep: WizardStep) => {
        const payload = { ...state, step: nextStep };
        await onboardingApi.updateStatus({
            status: "in_progress",
            onboardingPayload: payload,
        });
        setStep(nextStep);
    };

    const setupStoreAndPolicy = async () => {
        const storesResponse = await storesApi.list();
        if (!storesResponse.success) {
            throw new Error(storesResponse.error?.message || "店舗情報の取得に失敗しました");
        }

        const currentStore = (storesResponse.data as any[] | undefined)?.[0];
        if (currentStore?.id) {
            const updateResponse = await storesApi.update(currentStore.id, {
                name: state.storeName,
                address: state.address || undefined,
                phone: state.phone || undefined,
                timezone: state.timezone,
                slotDuration: state.slotDuration,
                advanceBookingDays: state.advanceBookingDays,
                cancelDeadlineHours: state.cancelDeadlineHours,
            });
            if (!updateResponse.success) {
                throw new Error(updateResponse.error?.message || "店舗情報の更新に失敗しました");
            }
        }

        const businessResponse = await settingsApi.updateBusiness({
            slotDuration: state.slotDuration,
            advanceBookingDays: state.advanceBookingDays,
            cancelDeadlineHours: state.cancelDeadlineHours,
        });
        if (!businessResponse.success) {
            throw new Error(businessResponse.error?.message || "予約ポリシーの更新に失敗しました");
        }
    };

    const setupInitialMenuAndPractitioner = async () => {
        const menusResponse = await menusApi.list();
        if (!menusResponse.success) {
            throw new Error(menusResponse.error?.message || "メニュー一覧の取得に失敗しました");
        }
        const menus = menusResponse.data as any[] | undefined;
        if (!menus || menus.length === 0) {
            const createMenuResponse = await menusApi.create({
                name: state.menuName,
                category: state.menuCategory,
                price: state.menuPrice,
                duration: state.menuDuration,
                isActive: true,
            });
            if (!createMenuResponse.success) {
                throw new Error(createMenuResponse.error?.message || "初期メニューの作成に失敗しました");
            }
        }

        const practitionersResponse = await practitionersApi.list();
        if (!practitionersResponse.success) {
            throw new Error(practitionersResponse.error?.message || "スタッフ一覧の取得に失敗しました");
        }
        const practitioners = practitionersResponse.data as any[] | undefined;
        if (!practitioners || practitioners.length === 0) {
            const createPractitionerResponse = await practitionersApi.create({
                name: state.practitionerName,
                role: "owner",
                color: "#3b82f6",
                nominationFee: 0,
                schedule: {
                    workDays: [1, 2, 3, 4, 5, 6],
                    workHours: { start: "10:00", end: "19:00" },
                },
                isActive: true,
            });
            if (!createPractitionerResponse.success) {
                throw new Error(createPractitionerResponse.error?.message || "初期スタッフの作成に失敗しました");
            }
        }
    };

    const handleNext = async () => {
        if (step === 6) return;
        setSubmitting(true);
        setError("");
        try {
            if (step === 2 || step === 3) {
                await setupStoreAndPolicy();
            }
            if (step === 4) {
                await setupInitialMenuAndPractitioner();
            }
            await saveProgress((step + 1) as WizardStep);
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
            window.open(response.data.authUrl, "_blank", "noopener,noreferrer");
        } catch (err: any) {
            setError(err?.message || "Google OAuth開始に失敗しました");
        } finally {
            setSubmitting(false);
        }
    };

    const completeOnboarding = async () => {
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
                <p className="text-sm text-gray-500 mt-1">
                    tenant: <span className="font-mono">{tenantKey}</span>
                </p>
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
                        <label className="block text-sm">slug</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={state.slug} onChange={(e) => setState((prev) => ({ ...prev, slug: e.target.value }))} />
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
                    </>
                )}

                {step === 6 && (
                    <>
                        <h2 className="text-lg font-semibold">完了確認</h2>
                        <p className="text-sm text-gray-600">初期設定を完了すると管理画面トップへ遷移します。</p>
                        <div className="rounded-lg border border-gray-200 p-3 text-sm">
                            <p>テナント: {state.tenantName || tenantKey}</p>
                            <p>店舗: {state.storeName}</p>
                            <p>予約ポリシー: {state.advanceBookingDays}日先 / {state.cancelDeadlineHours}時間前締切</p>
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
            </div>

            <div className="flex items-center justify-between">
                <Button type="button" variant="outline" onClick={handleBack} disabled={step === 1 || submitting}>
                    戻る
                </Button>
                {step < 6 && (
                    <Button type="button" onClick={handleNext} disabled={submitting}>
                        {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</> : "次へ"}
                    </Button>
                )}
            </div>
        </div>
    );
}
