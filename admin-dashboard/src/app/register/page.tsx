"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { platformOnboardingApi, setTenantKey } from "@/lib/api";

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

export default function RegisterPage() {
    const router = useRouter();
    const { register, getAuthToken, logout, user } = useAuth();

    const [tenantName, setTenantName] = useState("");
    const [slug, setSlug] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [storeName, setStoreName] = useState("");
    const [timezone, setTimezone] = useState("Asia/Tokyo");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [slugChecking, setSlugChecking] = useState(false);
    const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        let mounted = true;
        platformOnboardingApi.getRegistrationConfig().then((response) => {
            if (!mounted || !response.success) return;
            setEnabled(response.data?.enabled !== false);
        }).catch(() => {
            // noop: keep default true and handle on submit.
        });

        return () => {
            mounted = false;
        };
    }, []);

    const normalizedSlug = useMemo(() => slug.trim().toLowerCase(), [slug]);
    const isSlugFormatValid = normalizedSlug.length >= 3 && slugRegex.test(normalizedSlug);

    useEffect(() => {
        if (!storeName.trim() && tenantName.trim()) {
            setStoreName(`${tenantName.trim()} 本店`);
        }
    }, [tenantName, storeName]);

    const checkSlug = async () => {
        if (!isSlugFormatValid) {
            setSlugAvailable(null);
            return;
        }

        setSlugChecking(true);
        setError("");
        try {
            const response = await platformOnboardingApi.checkSlugAvailability(normalizedSlug);
            if (!response.success) {
                throw new Error(response.error?.message || "slugの確認に失敗しました");
            }
            setSlugAvailable(Boolean(response.data?.available));
        } catch (err: any) {
            setError(err?.message || "slugの確認に失敗しました");
            setSlugAvailable(null);
        } finally {
            setSlugChecking(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");

        if (!enabled) {
            setError("現在は新規登録を受け付けていません。");
            return;
        }

        if (!isSlugFormatValid) {
            setError("slug形式が不正です（英小文字・数字・ハイフンのみ、3〜40文字）");
            return;
        }

        if (slugAvailable === false) {
            setError("このslugは既に使用されています。");
            return;
        }

        if (!email || !password) {
            setError("メールアドレスとパスワードを入力してください。");
            return;
        }

        if (password.length < 8) {
            setError("パスワードは8文字以上で入力してください。");
            return;
        }

        if (password !== confirmPassword) {
            setError("パスワード確認が一致しません。");
            return;
        }

        setLoading(true);
        try {
            if (user) {
                await logout();
            }

            await register(email, password, ownerName || undefined);
            const idToken = await getAuthToken();
            if (!idToken) {
                throw new Error("Firebase ID Token の取得に失敗しました");
            }

            const response = await platformOnboardingApi.registerTenant({
                idToken,
                slug: normalizedSlug,
                tenantName,
                ownerName: ownerName || undefined,
                storeName: storeName || undefined,
                timezone,
                address: address || undefined,
                phone: phone || undefined,
            });

            if (!response.success || !response.data?.tenantKey) {
                throw new Error(response.error?.message || "テナント登録に失敗しました");
            }

            setTenantKey(response.data.tenantKey);
            router.push(`/onboarding?tenant=${encodeURIComponent(response.data.tenantKey)}`);
        } catch (err: any) {
            setError(err?.message || "登録に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center">
                        <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">美容室 新規登録</h1>
                        <p className="text-sm text-gray-500">公開セルフ登録（管理テナント作成）</p>
                    </div>
                </div>

                {!enabled && (
                    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        現在、新規登録を停止しています。
                    </div>
                )}

                {error && (
                    <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">サロン名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">slug（URL識別子）</label>
                        <div className="flex items-center gap-2">
                            <input
                                className="w-full border rounded-lg px-3 py-2"
                                value={slug}
                                onChange={(e) => {
                                    setSlug(e.target.value);
                                    setSlugAvailable(null);
                                }}
                                onBlur={checkSlug}
                                required
                            />
                            <Button type="button" variant="outline" onClick={checkSlug} disabled={slugChecking}>
                                {slugChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "確認"}
                            </Button>
                        </div>
                        {slugAvailable === true && <p className="text-xs text-emerald-600 mt-1">使用可能です</p>}
                        {slugAvailable === false && <p className="text-xs text-red-600 mt-1">既に使用されています</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">オーナー名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">初期店舗名</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">タイムゾーン</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">電話番号（任意）</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">住所（任意）</label>
                        <input className="w-full border rounded-lg px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">管理者メールアドレス</label>
                        <input type="email" className="w-full border rounded-lg px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">パスワード</label>
                        <input type="password" className="w-full border rounded-lg px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium mb-1">パスワード確認</label>
                        <input type="password" className="w-full border rounded-lg px-3 py-2" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
                    </div>

                    <div className="md:col-span-2 flex items-center justify-between pt-2">
                        <Link href="/login" className="text-sm text-gray-500 hover:underline">既存アカウントでログイン</Link>
                        <Button type="submit" disabled={loading || !enabled}>
                            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />登録中...</> : "無料で始める"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
