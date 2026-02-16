"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Scissors, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { apiClient, getTenantKeyOrNull, withTenantQuery } from "@/lib/api";

export default function SignupPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { register } = useAuth();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [canRegister, setCanRegister] = useState(false);
    const [error, setError] = useState("");
    const tenantKeyFromQuery = searchParams.get("tenant") || searchParams.get("tenantKey") || undefined;

    useEffect(() => {
        const checkBootstrapStatus = async () => {
            setIsChecking(true);
            setError("");
            try {
                const response = await apiClient<{ canRegister: boolean }>('/auth/admin/bootstrap-status', {
                    includeAuth: false,
                });
                if (!response.success) {
                    throw new Error(response.error?.message || "初期登録状態の確認に失敗しました");
                }
                setCanRegister(Boolean(response.data?.canRegister));
            } catch (err: any) {
                setCanRegister(false);
                setError(err?.message || "初期登録状態の確認に失敗しました");
            } finally {
                setIsChecking(false);
            }
        };

        checkBootstrapStatus();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!canRegister) {
            setError("このテナントは初期登録済みです。既存アカウントでログインしてください。");
            return;
        }

        if (password !== confirmPassword) {
            setError("パスワードが一致しません");
            return;
        }

        if (password.length < 8) {
            setError("パスワードは8文字以上で入力してください");
            return;
        }

        setIsLoading(true);
        try {
            await register(email, password, name);
            router.push(withTenantQuery("/", tenantKeyFromQuery));
        } catch (err: any) {
            if (err.code === "auth/email-already-in-use") {
                setError("このメールアドレスは既に使用されています");
            } else if (err.code === "auth/invalid-email") {
                setError("メールアドレスの形式が正しくありません");
            } else if (err.code === "auth/weak-password") {
                setError("パスワードが弱すぎます。8文字以上で設定してください");
            } else {
                setError(`新規登録に失敗しました (${err.code || err.message})`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
            <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4">
                        <Scissors className="h-8 w-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">初回管理者登録</h1>
                    <p className="text-gray-500 mt-1">最初のオーナーアカウントを作成（tenant: {tenantKeyFromQuery || getTenantKeyOrNull() || "未指定"}）</p>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8">
                    {isChecking ? (
                        <div className="py-10 flex flex-col items-center gap-3 text-gray-500">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <p className="text-sm">登録可否を確認中...</p>
                        </div>
                    ) : !canRegister ? (
                        <div className="space-y-4">
                            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
                                このテナントは既に初期登録済みです。新規登録は無効です。
                            </div>
                            <Button className="w-full" asChild>
                                <Link href={withTenantQuery("/login", tenantKeyFromQuery)}>ログイン画面へ</Link>
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {error && (
                                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                                    {error}
                                </div>
                            )}

                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                                    名前
                                </label>
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="オーナー名"
                                    required
                                    className="w-full h-12 px-4 rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
                                />
                            </div>

                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                                    メールアドレス
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="owner@salon.com"
                                    required
                                    className="w-full h-12 px-4 rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
                                />
                            </div>

                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                                    パスワード
                                </label>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="8文字以上"
                                        required
                                        minLength={8}
                                        className="w-full h-12 px-4 pr-12 rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                                    パスワード確認
                                </label>
                                <input
                                    id="confirm-password"
                                    type={showPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="同じパスワードを入力"
                                    required
                                    minLength={8}
                                    className="w-full h-12 px-4 rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
                                />
                            </div>

                            <Button type="submit" className="w-full h-12 text-base" disabled={isLoading}>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        登録中...
                                    </>
                                ) : (
                                    <>
                                        <UserPlus className="mr-2 h-5 w-5" />
                                        新規登録
                                    </>
                                )}
                            </Button>

                            <p className="text-xs text-gray-500 text-center">
                                登録後、初回APIアクセス時に owner 権限が自動付与されます。
                            </p>
                        </form>
                    )}

                    <div className="mt-6 pt-6 border-t border-gray-100 text-center text-sm text-gray-500">
                        既にアカウントをお持ちですか？{" "}
                        <Link href={withTenantQuery("/login", tenantKeyFromQuery)} className="text-primary hover:underline">
                            ログイン
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
