"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Calendar, CheckCircle2, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminJobsApi, googleCalendarApi } from "@/lib/api";

interface GoogleStatus {
    connected: boolean;
    status: "active" | "expired" | "revoked" | "not_connected";
    email?: string;
    scope?: string;
    updatedAt?: string;
    queue?: {
        pending: number;
        running: number;
        failed: number;
        dead: number;
        nextRunAt?: string;
        lastError?: string;
        lastAttemptAt?: string;
        lastSuccessAt?: string;
    };
}

export default function IntegrationsPage() {
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [jobRunning, setJobRunning] = useState(false);
    const [jobResult, setJobResult] = useState<string | null>(null);
    const [analyticsDate, setAnalyticsDate] = useState("");
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await googleCalendarApi.getStatus();
            if (!res.success || !res.data) {
                throw new Error(res.error?.message || "Google連携状態の取得に失敗しました");
            }
            setStatus(res.data as GoogleStatus);
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Google連携状態の取得に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const startOAuth = async () => {
        setRunning(true);
        setError(null);
        try {
            const res = await googleCalendarApi.startOAuth();
            if (!res.success || !res.data) {
                throw new Error(res.error?.message || "OAuth開始に失敗しました");
            }
            const authUrl = (res.data as { authUrl: string }).authUrl;
            if (!authUrl) {
                throw new Error("OAuth URL が返却されませんでした");
            }
            window.open(authUrl, "_blank", "noopener,noreferrer");
        } catch (err: any) {
            console.error(err);
            setError(err.message || "OAuth開始に失敗しました");
        } finally {
            setRunning(false);
        }
    };

    const revoke = async () => {
        if (!confirm("Google Calendar連携を解除しますか？")) return;

        setRunning(true);
        setError(null);
        try {
            const res = await googleCalendarApi.revoke();
            if (!res.success) {
                throw new Error(res.error?.message || "連携解除に失敗しました");
            }
            await fetchStatus();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "連携解除に失敗しました");
        } finally {
            setRunning(false);
        }
    };

    const statusLabel = (value: GoogleStatus["status"] | undefined) => {
        if (value === "active") return "連携中";
        if (value === "expired") return "期限切れ";
        if (value === "revoked") return "解除済み";
        return "未連携";
    };

    const runManualJob = async (job: "day-before" | "same-day" | "analytics" | "google-sync" | "google-retry-dead") => {
        setJobRunning(true);
        setJobResult(null);
        setError(null);

        try {
            const response =
                job === "day-before"
                    ? await adminJobsApi.runDayBeforeReminder()
                    : job === "same-day"
                      ? await adminJobsApi.runSameDayReminder()
                      : job === "google-retry-dead"
                        ? await adminJobsApi.runGoogleCalendarRetry(100, false)
                      : job === "google-sync"
                        ? await adminJobsApi.runGoogleCalendarSync()
                      : await adminJobsApi.runDailyAnalytics(analyticsDate || undefined);

            if (!response.success || !response.data) {
                throw new Error(response.error?.message || "ジョブ実行に失敗しました");
            }

            const stats = response.data as Record<string, unknown>;
            if (job === "analytics") {
                const analyticsStats = stats.stats as Record<string, unknown> | undefined;
                const targetDate = String(analyticsStats?.targetDate ?? "-");
                const rowsUpserted = Number(analyticsStats?.rowsUpserted ?? 0);
                const storesProcessed = Number(analyticsStats?.storesProcessed ?? 0);
                setJobResult(`日次集計を実行しました (${targetDate}) / stores: ${storesProcessed} / upsert: ${rowsUpserted}件`);
            } else if (job === "google-sync") {
                const syncStats = stats.stats as Record<string, unknown> | undefined;
                const processed = Number(syncStats?.processed ?? 0);
                const succeeded = Number(syncStats?.succeeded ?? 0);
                const failed = Number(syncStats?.failed ?? 0);
                const dead = Number(syncStats?.dead ?? 0);
                const remaining = Number(syncStats?.remainingPending ?? 0);
                setJobResult(`Google同期キューを処理しました / processed: ${processed}, ok: ${succeeded}, failed: ${failed}, dead: ${dead}, remaining: ${remaining}`);
                await fetchStatus();
            } else if (job === "google-retry-dead") {
                const retryStats = stats.stats as Record<string, unknown> | undefined;
                const reset = Number(retryStats?.reset ?? 0);
                const fromDead = Number(retryStats?.fromDead ?? 0);
                const fromFailed = Number(retryStats?.fromFailed ?? 0);
                setJobResult(`Google deadキューを再投入しました / reset: ${reset}, fromDead: ${fromDead}, fromFailed: ${fromFailed}`);
                await fetchStatus();
            } else {
                const reminderStats = stats.stats as Record<string, unknown> | undefined;
                const sent = Number(reminderStats?.sent ?? 0);
                const failed = Number(reminderStats?.failed ?? 0);
                setJobResult(`リマインダー送信を実行しました / sent: ${sent}件, failed: ${failed}件`);
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "ジョブ実行に失敗しました");
        } finally {
            setJobRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">外部連携</h1>
                    <p className="text-muted-foreground">Google Calendar 連携状態を管理します</p>
                </div>
                <Button variant="outline" size="icon" onClick={fetchStatus}>
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Google Calendar
                    </CardTitle>
                    <CardDescription>
                        予約作成・変更・キャンセル時のイベント同期に利用します
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-28 flex items-center justify-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-lg border p-4">
                                    <div className="text-sm text-muted-foreground">ステータス</div>
                                    <div className="mt-1 flex items-center gap-2 font-semibold">
                                        {status?.connected ? (
                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        ) : (
                                            <Unplug className="h-4 w-4 text-gray-500" />
                                        )}
                                        {statusLabel(status?.status)}
                                    </div>
                                </div>
                                <div className="rounded-lg border p-4">
                                    <div className="text-sm text-muted-foreground">連携アカウント</div>
                                    <div className="mt-1 font-semibold">{status?.email || "-"}</div>
                                </div>
                            </div>

                            <div className="rounded-lg border p-4 text-sm text-muted-foreground space-y-1">
                                <div>scope: {status?.scope || "-"}</div>
                                <div>updated: {status?.updatedAt || "-"}</div>
                                {status?.queue && (
                                    <div>
                                        queue: pending {status.queue.pending}, running {status.queue.running}, failed {status.queue.failed}, dead {status.queue.dead}
                                    </div>
                                )}
                                {status?.queue?.lastError && (
                                    <div className="text-red-600">lastError: {status.queue.lastError}</div>
                                )}
                            </div>

                            <div className="flex gap-2">
                                <Button onClick={startOAuth} disabled={running}>
                                    <Link2 className="mr-2 h-4 w-4" />
                                    OAuth開始
                                </Button>
                                <Button variant="outline" onClick={revoke} disabled={running || !status?.connected}>
                                    連携解除
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>運用ジョブ（手動実行）</CardTitle>
                    <CardDescription>
                        管理者権限でリマインダー送信と日次集計を手動で実行します
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-end gap-3">
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">集計対象日（任意）</div>
                            <input
                                type="date"
                                value={analyticsDate}
                                onChange={(e) => setAnalyticsDate(e.target.value)}
                                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                            />
                        </div>
                        <div className="text-xs text-muted-foreground">
                            未指定時は前日（JST）を集計
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            disabled={jobRunning}
                            onClick={() => runManualJob("day-before")}
                        >
                            前日リマインダー実行
                        </Button>
                        <Button
                            variant="outline"
                            disabled={jobRunning}
                            onClick={() => runManualJob("same-day")}
                        >
                            当日リマインダー実行
                        </Button>
                        <Button
                            variant="outline"
                            disabled={jobRunning}
                            onClick={() => runManualJob("analytics")}
                        >
                            日次集計実行（前日）
                        </Button>
                        <Button
                            variant="outline"
                            disabled={jobRunning}
                            onClick={() => runManualJob("google-sync")}
                        >
                            Google同期キュー処理
                        </Button>
                        <Button
                            variant="outline"
                            disabled={jobRunning}
                            onClick={() => runManualJob("google-retry-dead")}
                        >
                            Google deadキュー再投入
                        </Button>
                    </div>

                    {jobRunning && (
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            ジョブを実行しています...
                        </div>
                    )}

                    {jobResult && (
                        <div className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                            {jobResult}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
