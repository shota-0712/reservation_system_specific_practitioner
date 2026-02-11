"use client";

import { useState, useEffect } from "react";
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reportsApi } from "@/lib/api";

interface SummaryData {
    revenue: { value: number; change: number };
    bookings: { value: number; change: number };
    avgSpend: { value: number; change: number };
    repeatRate: { value: number; change: number };
}

interface RevenueData {
    month: string;
    revenue: number;
}

interface MenuRankingData {
    name: string;
    count: number;
    revenue: number;
}

interface PractitionerRevenueData {
    name: string;
    revenue: number;
    customers: number;
}

const EMPTY_SUMMARY: SummaryData = {
    revenue: { value: 0, change: 0 },
    bookings: { value: 0, change: 0 },
    avgSpend: { value: 0, change: 0 },
    repeatRate: { value: 0, change: 0 },
};

const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

export default function ReportsPage() {
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<SummaryData>(EMPTY_SUMMARY);
    const [monthlyRevenue, setMonthlyRevenue] = useState<RevenueData[]>([]);
    const [menuRanking, setMenuRanking] = useState<MenuRankingData[]>([]);
    const [practitionerRevenue, setPractitionerRevenue] = useState<PractitionerRevenueData[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchReports = async () => {
            try {
                setError(null);
                const [summaryRes, revenueRes, menuRes, practitionerRes] = await Promise.all([
                    reportsApi.getSummary("month"),
                    reportsApi.getRevenue(),
                    reportsApi.getMenuRanking(),
                    reportsApi.getPractitionerRevenue(),
                ]);

                if (summaryRes.success && summaryRes.data && typeof summaryRes.data === "object") {
                    const raw = summaryRes.data as Partial<SummaryData>;
                    setSummary({
                        revenue: {
                            value: toNumber(raw.revenue?.value),
                            change: toNumber(raw.revenue?.change),
                        },
                        bookings: {
                            value: toNumber(raw.bookings?.value),
                            change: toNumber(raw.bookings?.change),
                        },
                        avgSpend: {
                            value: toNumber(raw.avgSpend?.value),
                            change: toNumber(raw.avgSpend?.change),
                        },
                        repeatRate: {
                            value: toNumber(raw.repeatRate?.value),
                            change: toNumber(raw.repeatRate?.change),
                        },
                    });
                } else {
                    setSummary(EMPTY_SUMMARY);
                }

                if (revenueRes.success && Array.isArray(revenueRes.data)) {
                    const data: RevenueData[] = revenueRes.data.map((row) => {
                        const item = row as Partial<RevenueData> & { label?: string; date?: string };
                        return {
                            month: item.month || item.label || item.date || "-",
                            revenue: toNumber(item.revenue),
                        };
                    });
                    setMonthlyRevenue(data);
                } else {
                    setMonthlyRevenue([]);
                }

                if (menuRes.success && Array.isArray(menuRes.data)) {
                    const data: MenuRankingData[] = menuRes.data.map((row) => {
                        const item = row as Partial<MenuRankingData>;
                        return {
                            name: item.name || "未設定",
                            count: toNumber(item.count),
                            revenue: toNumber(item.revenue),
                        };
                    });
                    setMenuRanking(data);
                } else {
                    setMenuRanking([]);
                }

                if (practitionerRes.success && Array.isArray(practitionerRes.data)) {
                    const data: PractitionerRevenueData[] = practitionerRes.data.map((row) => {
                        const item = row as Partial<PractitionerRevenueData>;
                        return {
                            name: item.name || "未設定",
                            revenue: toNumber(item.revenue),
                            customers: toNumber(item.customers),
                        };
                    });
                    setPractitionerRevenue(data);
                } else {
                    setPractitionerRevenue([]);
                }
            } catch (error) {
                console.error("Failed to fetch reports:", error);
                setError("レポートデータの取得に失敗しました");
                setSummary(EMPTY_SUMMARY);
                setMonthlyRevenue([]);
                setMenuRanking([]);
                setPractitionerRevenue([]);
            } finally {
                setLoading(false);
            }
        };

        fetchReports();
    }, []);

    const formatChange = (change: number) => {
        if (change > 0) return `+${change}%`;
        if (change < 0) return `${change}%`;
        return "0%";
    };

    const getChangeColor = (change: number) => {
        if (change > 0) return "text-green-500";
        if (change < 0) return "text-red-500";
        return "text-gray-500";
    };

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const totalMenuRevenue = menuRanking.reduce((sum, m) => sum + m.revenue, 0);

    return (
            <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">レポート</h1>
                <p className="text-muted-foreground">
                    売上・メニュー・スタッフの分析データ
                </p>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">今月の売上</div>
                        <div className="text-2xl font-bold">
                            ¥{summary.revenue.value.toLocaleString()}
                        </div>
                        <div className={`text-xs ${getChangeColor(summary.revenue.change)}`}>
                            {formatChange(summary.revenue.change)} 前月比
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">今月の予約数</div>
                        <div className="text-2xl font-bold">
                            {summary.bookings.value.toLocaleString()}件
                        </div>
                        <div className={`text-xs ${getChangeColor(summary.bookings.change)}`}>
                            {formatChange(summary.bookings.change)} 前月比
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">平均客単価</div>
                        <div className="text-2xl font-bold">
                            ¥{summary.avgSpend.value.toLocaleString()}
                        </div>
                        <div className={`text-xs ${getChangeColor(summary.avgSpend.change)}`}>
                            {formatChange(summary.avgSpend.change)} 前月比
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">リピート率</div>
                        <div className="text-2xl font-bold">
                            {summary.repeatRate.value.toFixed(1)}%
                        </div>
                        <div className={`text-xs ${getChangeColor(summary.repeatRate.change)}`}>
                            {formatChange(summary.repeatRate.change)} 前月比
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">月次売上推移</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px]">
                            {monthlyRevenue.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                    データがありません
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={monthlyRevenue}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="month"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: "#6b7280", fontSize: 12 }}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: "#6b7280", fontSize: 12 }}
                                            tickFormatter={(value) => `¥${(value / 10000).toFixed(0)}万`}
                                        />
                                        <Tooltip
                                            formatter={(value: number) => [
                                                `¥${value.toLocaleString()}`,
                                                "売上",
                                            ]}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="revenue"
                                            stroke="hsl(346, 77%, 49%)"
                                            strokeWidth={2}
                                            dot={{ fill: "hsl(346, 77%, 49%)" }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">スタッフ別売上</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px]">
                            {practitionerRevenue.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                    データがありません
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={practitionerRevenue} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis
                                            type="number"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: "#6b7280", fontSize: 12 }}
                                            tickFormatter={(value) => `¥${(value / 10000).toFixed(0)}万`}
                                        />
                                        <YAxis
                                            type="category"
                                            dataKey="name"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: "#6b7280", fontSize: 12 }}
                                            width={80}
                                        />
                                        <Tooltip
                                            formatter={(value: number) => [
                                                `¥${value.toLocaleString()}`,
                                                "売上",
                                            ]}
                                        />
                                        <Bar
                                            dataKey="revenue"
                                            fill="hsl(346, 77%, 49%)"
                                            radius={[0, 4, 4, 0]}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">メニュー別ランキング</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b text-left text-sm text-muted-foreground">
                                    <th className="pb-3 font-medium">順位</th>
                                    <th className="pb-3 font-medium">メニュー名</th>
                                    <th className="pb-3 font-medium text-right">予約数</th>
                                    <th className="pb-3 font-medium text-right">売上</th>
                                    <th className="pb-3 font-medium">構成比</th>
                                </tr>
                            </thead>
                            <tbody>
                                {menuRanking.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="py-8 text-center text-sm text-muted-foreground"
                                        >
                                            データがありません
                                        </td>
                                    </tr>
                                ) : (
                                    menuRanking.map((menu, index) => {
                                        const percentage = totalMenuRevenue > 0
                                            ? (menu.revenue / totalMenuRevenue) * 100
                                            : 0;
                                        return (
                                            <tr key={menu.name} className="border-b last:border-b-0">
                                                <td className="py-4">
                                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                                                        {index + 1}
                                                    </span>
                                                </td>
                                                <td className="py-4 font-medium">{menu.name}</td>
                                                <td className="py-4 text-right">{menu.count}件</td>
                                                <td className="py-4 text-right font-medium">
                                                    ¥{menu.revenue.toLocaleString()}
                                                </td>
                                                <td className="py-4 w-48">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-primary rounded-full"
                                                                style={{ width: `${percentage}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-sm text-muted-foreground w-12">
                                                            {percentage.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
