"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Practitioner {
    id: string;
    name: string;
    bookedMinutes: number;
    workMinutes: number;
    utilizationRate: number;
}

interface StaffUtilizationProps {
    practitioners: Practitioner[];
}

function getUtilizationColor(value: number): string {
    if (value >= 80) return "bg-green-500";
    if (value >= 50) return "bg-yellow-500";
    return "bg-red-500";
}

export function StaffUtilization({ practitioners }: StaffUtilizationProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-semibold">スタッフ稼働率</CardTitle>
            </CardHeader>
            <CardContent>
                {practitioners.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">
                        データがありません
                    </div>
                ) : (
                    <div className="space-y-4">
                        {practitioners.map((practitioner) => (
                            <div key={practitioner.id} className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-medium">{practitioner.name}</span>
                                    <span className="text-muted-foreground">
                                        {Math.round(practitioner.bookedMinutes / 60)}h /{" "}
                                        {practitioner.workMinutes > 0 ? `${Math.round(practitioner.workMinutes / 60)}h` : "-"}
                                    </span>
                                </div>
                                <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                    <div
                                        className={`absolute left-0 top-0 h-full transition-all ${getUtilizationColor(
                                            practitioner.utilizationRate
                                        )}`}
                                        style={{ width: `${practitioner.utilizationRate}%` }}
                                    />
                                </div>
                                <div className="text-right text-sm font-bold text-muted-foreground">
                                    {practitioner.utilizationRate}%
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
