"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Scissors, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            await login(email, password);
            router.push("/");
        } catch (err: any) {
            console.error('Login error:', err);
            // Firebase error codes
            if (err.code === 'auth/user-not-found') {
                setError("このメールアドレスは登録されていません");
            } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                setError("パスワードが正しくありません");
            } else if (err.code === 'auth/invalid-email') {
                setError("メールアドレスの形式が正しくありません");
            } else if (err.code === 'auth/too-many-requests') {
                setError("ログイン試行回数が上限を超えました。しばらくお待ちください");
            } else {
                setError(`ログインに失敗しました (${err.code || err.message})`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4">
                        <Scissors className="h-8 w-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Salon Admin</h1>
                    <p className="text-gray-500 mt-1">管理画面にログイン</p>
                </div>

                {/* Login Form */}
                <div className="bg-white rounded-2xl shadow-lg p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Error Message */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        {/* Email */}
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                                メールアドレス
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="admin@salon.com"
                                required
                                className="w-full h-12 px-4 rounded-lg border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors"
                            />
                        </div>

                        {/* Password */}
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
                                    placeholder="••••••••"
                                    required
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

                        {/* Remember & Forgot */}
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <span className="text-sm text-gray-600">ログイン状態を保持</span>
                            </label>
                            <a href="#" className="text-sm text-primary hover:underline">
                                パスワードを忘れた場合
                            </a>
                        </div>

                        {/* Submit */}
                        <Button
                            type="submit"
                            className="w-full h-12 text-base"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    ログイン中...
                                </>
                            ) : (
                                "ログイン"
                            )}
                        </Button>
                    </form>

                    {/* Info */}
                    <div className="mt-6 pt-6 border-t border-gray-100">
                        <p className="text-xs text-gray-400 text-center">
                            Firebase Authenticationで認証しています
                        </p>
                        <p className="text-xs text-gray-500 text-center mt-2">
                            新規でサロンを開設する場合は{" "}
                            <Link href="/register" className="text-primary hover:underline">
                                サロン登録
                            </Link>
                            {" / "}
                            既存tenantの初回管理者登録は{" "}
                            <Link href="/signup" className="text-primary hover:underline">
                                こちら
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-sm text-gray-400 mt-6">
                    © 2026 Salon Admin. All rights reserved.
                </p>
            </div>
        </div>
    );
}
