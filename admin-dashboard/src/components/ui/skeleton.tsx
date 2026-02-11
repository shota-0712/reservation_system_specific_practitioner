"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-gray-200",
                className
            )}
        />
    );
}

// Pre-built skeleton patterns

export function CardSkeleton() {
    return (
        <div className="bg-white rounded-xl border p-4 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
        </div>
    );
}

export function TableRowSkeleton() {
    return (
        <tr className="border-b">
            <td className="px-4 py-4">
                <Skeleton className="h-4 w-20" />
            </td>
            <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-20" />
                    </div>
                </div>
            </td>
            <td className="px-4 py-4">
                <Skeleton className="h-4 w-32" />
            </td>
            <td className="px-4 py-4">
                <Skeleton className="h-4 w-16" />
            </td>
            <td className="px-4 py-4">
                <Skeleton className="h-6 w-16 rounded-full" />
            </td>
        </tr>
    );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="bg-white rounded-xl border overflow-hidden">
            <div className="p-4 border-b">
                <Skeleton className="h-6 w-32" />
            </div>
            <table className="w-full">
                <thead>
                    <tr className="border-b bg-gray-50">
                        <th className="px-4 py-3"><Skeleton className="h-4 w-16" /></th>
                        <th className="px-4 py-3"><Skeleton className="h-4 w-20" /></th>
                        <th className="px-4 py-3"><Skeleton className="h-4 w-24" /></th>
                        <th className="px-4 py-3"><Skeleton className="h-4 w-16" /></th>
                        <th className="px-4 py-3"><Skeleton className="h-4 w-20" /></th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <TableRowSkeleton key={i} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <Skeleton className="h-8 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
                <div className="bg-white rounded-xl border p-4">
                    <Skeleton className="h-6 w-32 mb-4" />
                    <Skeleton className="h-64 w-full" />
                </div>
                <div className="bg-white rounded-xl border p-4">
                    <Skeleton className="h-6 w-32 mb-4" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>

            {/* Table */}
            <TableSkeleton rows={3} />
        </div>
    );
}

export function CustomerListSkeleton() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between">
                <div>
                    <Skeleton className="h-8 w-32 mb-2" />
                    <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-10 w-28" />
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} />
                ))}
            </div>

            {/* Search */}
            <Skeleton className="h-10 w-64" />

            {/* Table */}
            <TableSkeleton rows={5} />
        </div>
    );
}

export function CalendarSkeleton() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between">
                <div>
                    <Skeleton className="h-8 w-40 mb-2" />
                    <Skeleton className="h-4 w-56" />
                </div>
                <Skeleton className="h-10 w-28" />
            </div>

            {/* Date Navigation */}
            <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded" />
                <Skeleton className="h-10 w-10 rounded" />
                <Skeleton className="h-6 w-40" />
            </div>

            {/* Calendar Grid */}
            <div className="bg-white rounded-xl border overflow-hidden">
                <div className="flex border-b">
                    <Skeleton className="w-32 h-12" />
                    {Array.from({ length: 12 }).map((_, i) => (
                        <Skeleton key={i} className="w-20 h-12" />
                    ))}
                </div>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex border-b">
                        <div className="w-32 p-3">
                            <Skeleton className="h-4 w-20" />
                        </div>
                        <Skeleton className="flex-1 h-16" />
                    </div>
                ))}
            </div>
        </div>
    );
}
