"use client";

import { ArrowDown, ArrowUp, LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KPICardProps {
    title: string;
    value: string;
    change?: number;
    changeLabel?: string;
    icon?: LucideIcon;
    format?: "currency" | "number" | "percent";
}

export function KPICard({
    title,
    value,
    change,
    changeLabel = "前日比",
    icon: Icon,
}: KPICardProps) {
    const isPositive = (change ?? 0) >= 0;

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                        {title}
                    </span>
                    {Icon && (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                            <Icon className="h-4 w-4 text-primary" />
                        </div>
                    )}
                </div>

                <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>

                {change !== undefined && (
                    <div className="mt-2 flex items-center gap-1">
                        {isPositive ? (
                            <ArrowUp className="h-4 w-4 text-green-500" />
                        ) : (
                            <ArrowDown className="h-4 w-4 text-red-500" />
                        )}
                        <span
                            className={cn(
                                "text-sm font-medium",
                                isPositive ? "text-green-500" : "text-red-500"
                            )}
                        >
                            {isPositive ? "+" : ""}
                            {change}%
                        </span>
                        <span className="text-sm text-muted-foreground">{changeLabel}</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
