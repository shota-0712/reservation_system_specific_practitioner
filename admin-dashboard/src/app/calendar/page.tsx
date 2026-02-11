"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, AlertCircle } from "lucide-react";
import { format, addDays } from "date-fns";
import { ja } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { practitionersApi, reservationsApi } from "@/lib/api";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 9); // 9:00 - 20:00

interface Practitioner {
    id: string;
    name: string;
    color: string;
}

interface Reservation {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    practitionerId: string;
    customerName: string;
    menuNames: string[];
    status: string;
}

export default function CalendarPage() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // データ取得
    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            // 施術者を取得
            const practitionersRes = await practitionersApi.list();
            if (practitionersRes.success && practitionersRes.data) {
                setPractitioners(practitionersRes.data as Practitioner[]);
            }

            // 予約を取得
            const reservationsRes = await reservationsApi.list();
            if (reservationsRes.success && reservationsRes.data) {
                setReservations(reservationsRes.data as Reservation[]);
            }
        } catch (err) {
            console.error(err);
            setError('データの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const getReservationsForDayAndStaff = (staffId: string) => {
        const dateStr = format(currentDate, "yyyy-MM-dd");
        return reservations.filter(
            (r) => r.date === dateStr && r.practitionerId === staffId && r.status !== 'canceled'
        );
    };

    const getReservationStyle = (startTime: string, endTime: string) => {
        const [startHour, startMin] = startTime.split(":").map(Number);
        const [endHour, endMin] = endTime.split(":").map(Number);
        const left = (startHour - 9) * 80 + (startMin / 60) * 80;
        const width = ((endHour - startHour) * 60 + (endMin - startMin)) * (80 / 60);
        return { left: `${left}px`, width: `${width}px` };
    };

    // デフォルトカラーパレット（施術者にカラーが設定されていない場合）
    const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    const getColor = (practitioner: Practitioner, index: number) => {
        return practitioner.color || defaultColors[index % defaultColors.length];
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">予約カレンダー</h1>
                    <p className="text-muted-foreground">
                        スタッフごとの予約状況を確認できます
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchData}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        新規予約
                    </Button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            {/* Date Navigation */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentDate(addDays(currentDate, -1))}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentDate(addDays(currentDate, 1))}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <span className="ml-4 text-lg font-semibold">
                        {format(currentDate, "yyyy年M月d日 (E)", { locale: ja })}
                    </span>
                </div>
                <Button variant="outline" onClick={() => setCurrentDate(new Date())}>
                    今日
                </Button>
            </div>

            {/* Calendar Grid - Staff on Y-axis, Time on X-axis */}
            <Card>
                <CardContent className="p-0 overflow-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                            読み込み中...
                        </div>
                    ) : practitioners.length === 0 ? (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                            スタッフが登録されていません
                        </div>
                    ) : (
                        <div className="min-w-[1200px]">
                            {/* Header Row - Time slots */}
                            <div className="flex border-b sticky top-0 bg-white z-10">
                                <div className="w-32 shrink-0 border-r p-3 text-sm font-medium text-muted-foreground">
                                    スタッフ
                                </div>
                                {HOURS.map((hour) => (
                                    <div
                                        key={hour}
                                        className="w-20 shrink-0 border-r p-2 text-center text-sm font-medium text-muted-foreground"
                                    >
                                        {hour}:00
                                    </div>
                                ))}
                            </div>

                            {/* Staff Rows */}
                            {practitioners.map((staff, index) => (
                                <div key={staff.id} className="flex border-b last:border-b-0">
                                    {/* Staff Name */}
                                    <div
                                        className="w-32 shrink-0 border-r p-3 flex items-center gap-2"
                                    >
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: getColor(staff, index) }}
                                        />
                                        <span className="text-sm font-medium">{staff.name}</span>
                                    </div>

                                    {/* Time Grid */}
                                    <div className="flex-1 relative h-16">
                                        {/* Hour grid lines */}
                                        <div className="flex h-full">
                                            {HOURS.map((hour) => (
                                                <div
                                                    key={hour}
                                                    className="w-20 shrink-0 border-r border-dashed border-gray-100 h-full"
                                                />
                                            ))}
                                        </div>

                                        {/* Reservations */}
                                        {getReservationsForDayAndStaff(staff.id).map((res) => (
                                            <div
                                                key={res.id}
                                                className="absolute top-1 bottom-1 rounded px-2 py-1 text-xs text-white overflow-hidden cursor-pointer hover:opacity-90 flex flex-col justify-center"
                                                style={{
                                                    ...getReservationStyle(res.startTime, res.endTime),
                                                    backgroundColor: getColor(staff, index),
                                                }}
                                                title={`${res.startTime}-${res.endTime} ${res.customerName} - ${res.menuNames?.join(', ')}`}
                                            >
                                                <div className="font-medium truncate">
                                                    {res.customerName}
                                                </div>
                                                <div className="truncate opacity-80">{res.menuNames?.[0]}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Legend */}
            {practitioners.length > 0 && (
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <span>スタッフカラー：</span>
                    {practitioners.map((staff, index) => (
                        <div key={staff.id} className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: getColor(staff, index) }}
                            />
                            <span>{staff.name}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
