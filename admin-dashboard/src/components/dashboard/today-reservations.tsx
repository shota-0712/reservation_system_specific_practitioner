"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Reservation {
    id: string;
    time: string;
    customerName: string;
    menuName: string;
    practitionerName: string;
    status: "confirmed" | "pending" | "completed" | "canceled" | "no_show";
}

interface TodayReservationsProps {
    reservations: Reservation[];
}

const statusConfig: Record<string, { label: string; color: string }> = {
    confirmed: { label: "確定", color: "bg-blue-100 text-blue-700" },
    pending: { label: "仮予約", color: "bg-yellow-100 text-yellow-700" },
    completed: { label: "完了", color: "bg-green-100 text-green-700" },
    canceled: { label: "キャンセル", color: "bg-gray-100 text-gray-500" },
    no_show: { label: "無断キャンセル", color: "bg-red-100 text-red-700" },
    in_progress: { label: "施術中", color: "bg-purple-100 text-purple-700" }, // Keep for compatibility if needed
};

export function TodayReservations({ reservations }: TodayReservationsProps) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg font-semibold">本日の予約</CardTitle>
                <span className="text-sm text-muted-foreground">
                    {reservations.length}件
                </span>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {reservations.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-8">
                            本日の予約はありません
                        </p>
                    ) : (
                        reservations.map((reservation) => (
                            <div
                                key={reservation.id}
                                className="flex items-center justify-between rounded-lg border p-4"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="text-center min-w-[3.5rem]">
                                        <div className="text-lg font-bold text-primary">
                                            {reservation.time}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-medium">{reservation.customerName}</div>
                                        <div className="text-sm text-muted-foreground">
                                            {reservation.menuName} / {reservation.practitionerName}
                                        </div>
                                    </div>
                                </div>
                                <span
                                    className={cn(
                                        "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap",
                                        statusConfig[reservation.status]?.color || "bg-gray-100 text-gray-700"
                                    )}
                                >
                                    {statusConfig[reservation.status]?.label || reservation.status}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
