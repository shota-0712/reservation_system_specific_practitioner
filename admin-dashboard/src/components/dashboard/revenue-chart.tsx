"use client";

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RevenueChartProps {
    data: {
        label: string;
        revenue: number;
    }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-semibold">月次売上推移（直近6ヶ月）</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-[300px]">
                    {data.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                            データがありません
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: "#6b7280", fontSize: 12 }}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: "#6b7280", fontSize: 12 }}
                                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                                />
                                <Tooltip
                                    formatter={(value: number) => [
                                        `¥${value.toLocaleString()}`,
                                        "売上",
                                    ]}
                                    labelStyle={{ color: "#374151" }}
                                    contentStyle={{
                                        backgroundColor: "white",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: "8px",
                                    }}
                                />
                                <Bar
                                    dataKey="revenue"
                                    fill="hsl(346, 77%, 49%)"
                                    radius={[4, 4, 0, 0]}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
