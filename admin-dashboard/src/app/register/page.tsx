"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { platformOnboardingApi, setTenantKey, withTenantQuery } from "@/lib/api";

export default function RegisterPage() {
    const router = useRouter();
    const { register, getAuthToken, logout, user } = useAuth();

    const [tenantName, setTenantName] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [storeName, setStoreName] = useState("");
    const [timezone, setTimezone] = useState("Asia/Tokyo");
    const [address, setAddress] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [tenantKeyFromQuery, setTenantKeyFromQuery] = useState<string | undefined>(undefined);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const key = params.get("tenant") || params.get("tenantKey") || undefined;
        setTenantKeyFromQuery(key || undefined);
    }, []);

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

    useEffect(() => {
        if (!storeName.trim() && tenantName.trim()) {
            setStoreName(`${tenantName.trim()} 本店`);
        }
    }, [tenantName, storeName]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");

        if (!enabled) {
            setError("現在は新規登録を受け付けていません。");
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
            router.push(withTenantQuery("/onboarding", response.data.tenantKey));
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
                        <p className="text-xs text-gray-500">
                            URL識別子（tenantKey）は登録後にシステムが自動発行します。
                        </p>
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
                        <Link href={withTenantQuery("/login", tenantKeyFromQuery)} className="text-sm text-gray-500 hover:underline">既存アカウントでログイン</Link>
                        <Button type="submit" disabled={loading || !enabled}>
                            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />登録中...</> : "無料で始める"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
