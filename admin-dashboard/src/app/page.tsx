"use client";

import { useEffect, useState } from "react";
import { DollarSign, Users, Calendar, TrendingUp, AlertCircle } from "lucide-react";
import { KPICard } from "@/components/dashboard/kpi-card";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { TodayReservations } from "@/components/dashboard/today-reservations";
import { StaffUtilization } from "@/components/dashboard/staff-utilization";
import { dashboardApi, reportsApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ReservationStatus =
    | "confirmed"
    | "pending"
    | "completed"
    | "canceled"
    | "no_show";

interface Reservation {
    id: string;
    time: string;
    customerName: string;
    menuName: string;
    practitionerName: string;
    status: ReservationStatus;
    totalPrice: number;
}

interface RevenuePoint {
    label: string;
    revenue: number;
}

interface StaffUtilizationRow {
    id: string;
    name: string;
    bookedMinutes: number;
    workMinutes: number;
    utilizationRate: number;
}

interface KpiMetric {
    value: number;
    change: number;
}

interface KpiData {
    revenue: KpiMetric;
    bookings: KpiMetric;
    newCustomers: KpiMetric;
}

interface WeeklySummaryItem {
    date: string;
    bookings: number;
    completed: number;
    revenue: number;
}

interface ActivityItem {
    action: string;
    entityType: string;
    actorType: string;
    actorName: string;
    createdAt: string;
}

const EMPTY_KPI: KpiData = {
    revenue: { value: 0, change: 0 },
    bookings: { value: 0, change: 0 },
    newCustomers: { value: 0, change: 0 },
};

const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const normalizeReservationStatus = (value: unknown): ReservationStatus => {
    const status = typeof value === "string" ? value : "";
    if (status === "confirmed") return "confirmed";
    if (status === "pending") return "pending";
    if (status === "completed") return "completed";
    if (status === "canceled") return "canceled";
    if (status === "no_show") return "no_show";
    return "pending";
};

const formatDateLabel = (value: string): string => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}/${date.getDate()}`;
};

const formatRelativeTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}日前`;
};

const getActivityLabel = (action: string, entityType: string): string => {
    const actionLabel =
        action === "CREATE"
            ? "作成"
            : action === "UPDATE"
              ? "更新"
              : action === "DELETE"
                ? "削除"
                : action || "操作";
    const entityLabel = entityType || "データ";
    return `${entityLabel}を${actionLabel}`;
};

export default function DashboardPage() {
    const [todayReservations, setTodayReservations] = useState<Reservation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState({
        revenue: 0,
        count: 0,
    });
    const [kpi, setKpi] = useState<KpiData>(EMPTY_KPI);
    const [revenueSeries, setRevenueSeries] = useState<RevenuePoint[]>([]);
    const [staffUtilization, setStaffUtilization] = useState<StaffUtilizationRow[]>([]);
    const [weeklySummary, setWeeklySummary] = useState<WeeklySummaryItem[]>([]);
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [
                    todayRes,
                    kpiRes,
                    revenueRes,
                    utilizationRes,
                    weeklySummaryRes,
                    activityRes,
                ] = await Promise.all([
                    dashboardApi.getToday(),
                    dashboardApi.getKpi(),
                    reportsApi.getRevenue(),
                    dashboardApi.getStaffUtilization(),
                    dashboardApi.getWeeklySummary(),
                    dashboardApi.getActivity(10),
                ]);

                const todayRows = todayRes.success && Array.isArray(todayRes.data) ? todayRes.data : [];
                const mappedToday: Reservation[] = todayRows.map((row) => {
                    const item = row as Record<string, unknown>;
                    const menuNames = Array.isArray(item.menuNames) ? item.menuNames : [];
                    const firstMenu = typeof menuNames[0] === "string" ? menuNames[0] : null;
                    const startTimeRaw = typeof item.startTime === "string" ? item.startTime : "--:--";
                    return {
                        id: typeof item.id === "string" ? item.id : "",
                        time: startTimeRaw.slice(0, 5),
                        customerName:
                            typeof item.customerName === "string" && item.customerName.trim()
                                ? item.customerName
                                : "ゲスト",
                        menuName: firstMenu ?? "不明",
                        practitionerName:
                            typeof item.practitionerName === "string" ? item.practitionerName : "未設定",
                        status: normalizeReservationStatus(item.status),
                        totalPrice: toNumber(item.totalPrice),
                    };
                });
                setTodayReservations(mappedToday);

                const fallbackRevenue = mappedToday
                    .filter((reservation) => reservation.status === "completed")
                    .reduce((sum, reservation) => sum + reservation.totalPrice, 0);
                const fallbackCount = mappedToday.filter((reservation) =>
                    ["confirmed", "pending", "completed"].includes(reservation.status)
                ).length;
                setStats({
                    revenue: fallbackRevenue,
                    count: fallbackCount,
                });

                if (kpiRes.success && kpiRes.data && typeof kpiRes.data === "object") {
                    const raw = kpiRes.data as Partial<KpiData>;
                    setKpi({
                        revenue: {
                            value: toNumber(raw.revenue?.value),
                            change: toNumber(raw.revenue?.change),
                        },
                        bookings: {
                            value: toNumber(raw.bookings?.value),
                            change: toNumber(raw.bookings?.change),
                        },
                        newCustomers: {
                            value: toNumber(raw.newCustomers?.value),
                            change: toNumber(raw.newCustomers?.change),
                        },
                    });
                } else {
                    setKpi(EMPTY_KPI);
                }

                if (revenueRes.success && Array.isArray(revenueRes.data)) {
                    const mappedRevenue: RevenuePoint[] = revenueRes.data.map((row) => {
                        const item = row as Record<string, unknown>;
                        const labelSource =
                            (typeof item.month === "string" && item.month) ||
                            (typeof item.label === "string" && item.label) ||
                            (typeof item.date === "string" && item.date) ||
                            "";
                        return {
                            label: labelSource,
                            revenue: toNumber(item.revenue),
                        };
                    });
                    setRevenueSeries(mappedRevenue);
                } else {
                    setRevenueSeries([]);
                }

                if (utilizationRes.success && Array.isArray(utilizationRes.data)) {
                    const mappedUtilization: StaffUtilizationRow[] = utilizationRes.data.map((row) => {
                        const item = row as Record<string, unknown>;
                        return {
                            id: typeof item.id === "string" ? item.id : "",
                            name: typeof item.name === "string" ? item.name : "未設定",
                            bookedMinutes: toNumber(item.bookedMinutes),
                            workMinutes: toNumber(item.workMinutes),
                            utilizationRate: toNumber(item.utilizationRate ?? item.utilization),
                        };
                    });
                    setStaffUtilization(mappedUtilization);
                } else {
                    setStaffUtilization([]);
                }

                if (weeklySummaryRes.success && Array.isArray(weeklySummaryRes.data)) {
                    const mappedWeekly: WeeklySummaryItem[] = weeklySummaryRes.data.map((row) => {
                        const item = row as Record<string, unknown>;
                        return {
                            date: typeof item.date === "string" ? item.date : "",
                            bookings: toNumber(item.bookings),
                            completed: toNumber(item.completed),
                            revenue: toNumber(item.revenue),
                        };
                    });
                    setWeeklySummary(mappedWeekly);
                } else {
                    setWeeklySummary([]);
                }

                if (activityRes.success && Array.isArray(activityRes.data)) {
                    const mappedActivities: ActivityItem[] = activityRes.data.map((row) => {
                        const item = row as Record<string, unknown>;
                        return {
                            action: typeof item.action === "string" ? item.action : "",
                            entityType: typeof item.entityType === "string" ? item.entityType : "",
                            actorType: typeof item.actorType === "string" ? item.actorType : "system",
                            actorName: typeof item.actorName === "string" ? item.actorName : "",
                            createdAt:
                                typeof item.createdAt === "string"
                                    ? item.createdAt
                                    : new Date().toISOString(),
                        };
                    });
                    setActivities(mappedActivities);
                } else {
                    setActivities([]);
                }
            } catch (err) {
                console.error(err);
                setError("データの取得に失敗しました");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    const avgUtilization = staffUtilization.length > 0
        ? Math.round(
            staffUtilization.reduce((sum, s) => sum + s.utilizationRate, 0) / staffUtilization.length
        )
        : 0;

    const kpiData = {
        todayRevenue: kpi.revenue.value || stats.revenue,
        todayReservations: kpi.bookings.value || stats.count,
        newCustomers: kpi.newCustomers.value,
        avgUtilization,
        revenueChange: kpi.revenue.change,
        reservationChange: kpi.bookings.change,
        newCustomerChange: kpi.newCustomers.change,
        utilizationChange: 0,
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
                <p className="text-muted-foreground">
                    本日の状況と売上をご確認ください
                </p>
            </div>

            {isLoading && (
                <div className="bg-blue-50 text-blue-700 p-4 rounded-lg">
                    データを読み込み中です...
                </div>
            )}

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KPICard
                    title="本日の売上"
                    value={`¥${kpiData.todayRevenue.toLocaleString()}`}
                    change={kpiData.revenueChange}
                    icon={DollarSign}
                />
                <KPICard
                    title="本日の予約"
                    value={`${kpiData.todayReservations}件`}
                    change={kpiData.reservationChange}
                    icon={Calendar}
                />
                <KPICard
                    title="新規顧客"
                    value={`${kpiData.newCustomers}人`}
                    change={kpiData.newCustomerChange}
                    icon={Users}
                />
                <KPICard
                    title="平均稼働率"
                    value={`${kpiData.avgUtilization}%`}
                    change={kpiData.utilizationChange}
                    icon={TrendingUp}
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <RevenueChart data={revenueSeries} />
                <StaffUtilization practitioners={staffUtilization} />
            </div>

            <TodayReservations reservations={todayReservations} />

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold">週次サマリー</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {weeklySummary.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-8">
                                週次データはありません
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {weeklySummary.map((item) => (
                                    <div
                                        key={item.date}
                                        className="flex items-center justify-between border-b pb-3 last:border-b-0"
                                    >
                                        <div className="text-sm font-medium">{formatDateLabel(item.date)}</div>
                                        <div className="text-sm text-muted-foreground">
                                            予約 {item.bookings}件 / 完了 {item.completed}件
                                        </div>
                                        <div className="text-sm font-semibold">
                                            ¥{item.revenue.toLocaleString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold">最新アクティビティ</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {activities.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-8">
                                アクティビティはありません
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activities.map((item, index) => (
                                    <div
                                        key={`${item.createdAt}-${item.action}-${index}`}
                                        className="border-b pb-3 last:border-b-0"
                                    >
                                        <div className="text-sm font-medium">
                                            {getActivityLabel(item.action, item.entityType)}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {item.actorName || item.actorType}・{formatRelativeTime(item.createdAt)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
