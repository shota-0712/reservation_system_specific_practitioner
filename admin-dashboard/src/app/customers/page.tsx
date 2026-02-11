"use client";

import { useState, useEffect } from "react";
import { Search, Phone, Mail, Calendar, User, AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { customersApi } from "@/lib/api";

interface Customer {
    id: string;
    name: string;
    phoneNumber?: string;
    email?: string;
    lineUserId?: string;
    totalVisits: number;
    totalSpend: number;
    rfmSegment?: string;
    tags?: string[];
    lastVisitAt?: string;
    createdAt: string;
}

interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
}

const rfmSegmentLabels: Record<string, { label: string; color: string }> = {
    champion: { label: "チャンピオン", color: "bg-emerald-100 text-emerald-700" },
    loyal: { label: "ロイヤル", color: "bg-blue-100 text-blue-700" },
    potential: { label: "ポテンシャル", color: "bg-amber-100 text-amber-700" },
    promising: { label: "有望", color: "bg-purple-100 text-purple-700" },
    needsAttention: { label: "要注意", color: "bg-orange-100 text-orange-700" },
    atRisk: { label: "リスク", color: "bg-red-100 text-red-700" },
    inactive: { label: "休眠", color: "bg-gray-100 text-gray-600" },
};

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [pagination, setPagination] = useState<PaginationInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);

    // データ取得
    const fetchCustomers = async (page: number = 1) => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await customersApi.list({ page, limit: 20 });
            if (res.success && res.data) {
                const items = (res.data as any[]).map((c) => ({
                    ...c,
                    phoneNumber: c.phoneNumber || c.phone || undefined,
                })) as Customer[];
                setCustomers(items);
                if (res.meta) {
                    setPagination(res.meta as PaginationInfo);
                }
            } else {
                setError(res.error?.message || 'データの取得に失敗しました');
            }
        } catch (err) {
            console.error(err);
            setError('データの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers(currentPage);
    }, [currentPage]);

    // 検索フィルタ
    const filteredCustomers = customers.filter((customer) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            customer.name.toLowerCase().includes(query) ||
            customer.phoneNumber?.includes(query) ||
            customer.email?.toLowerCase().includes(query)
        );
    });

    // 統計情報を計算
    const totalCustomers = pagination?.total || customers.length;
    const totalRevenue = customers.reduce((sum, c) => sum + (c.totalSpend || 0), 0);
    const avgVisits = customers.length > 0 ? customers.reduce((sum, c) => sum + (c.totalVisits || 0), 0) / customers.length : 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">顧客管理</h1>
                    <p className="text-muted-foreground">
                        顧客情報と来店履歴を管理します
                    </p>
                </div>
                <Button variant="outline" size="icon" onClick={() => fetchCustomers(currentPage)}>
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">総顧客数</div>
                        <div className="text-2xl font-bold">{totalCustomers.toLocaleString()}名</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">累計売上</div>
                        <div className="text-2xl font-bold">¥{totalRevenue.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">平均来店回数</div>
                        <div className="text-2xl font-bold">{avgVisits.toFixed(1)}回</div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="氏名・電話番号・メールで検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-10 pl-10 pr-4 rounded-lg border border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                />
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            {/* Customer List */}
            <Card>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                            読み込み中...
                        </div>
                    ) : filteredCustomers.length === 0 ? (
                        <div className="flex items-center justify-center h-64 text-muted-foreground">
                            {searchQuery ? '検索結果がありません' : '顧客が登録されていません'}
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b text-left text-sm text-muted-foreground">
                                    <th className="p-4 font-medium">顧客名</th>
                                    <th className="p-4 font-medium">連絡先</th>
                                    <th className="p-4 font-medium text-right">来店回数</th>
                                    <th className="p-4 font-medium text-right">累計売上</th>
                                    <th className="p-4 font-medium">セグメント</th>
                                    <th className="p-4 font-medium">タグ</th>
                                    <th className="p-4 font-medium">最終来店</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCustomers.map((customer) => {
                                    const segment = customer.rfmSegment ? rfmSegmentLabels[customer.rfmSegment] : null;
                                    return (
                                        <tr key={customer.id} className="border-b last:border-b-0 hover:bg-gray-50">
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                        <User className="h-5 w-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium">{customer.name}</div>
                                                        {customer.lineUserId && (
                                                            <div className="text-xs text-green-600">LINE連携済</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="space-y-1 text-sm">
                                                    {customer.phoneNumber && (
                                                        <div className="flex items-center gap-2 text-muted-foreground">
                                                            <Phone className="h-3 w-3" />
                                                            {customer.phoneNumber}
                                                        </div>
                                                    )}
                                                    {customer.email && (
                                                        <div className="flex items-center gap-2 text-muted-foreground">
                                                            <Mail className="h-3 w-3" />
                                                            {customer.email}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right font-medium">
                                                {customer.totalVisits || 0}回
                                            </td>
                                            <td className="p-4 text-right font-medium">
                                                ¥{(customer.totalSpend || 0).toLocaleString()}
                                            </td>
                                            <td className="p-4">
                                                {segment && (
                                                    <span className={cn("rounded-full px-2 py-1 text-xs font-medium", segment.color)}>
                                                        {segment.label}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {customer.tags?.map((tag) => (
                                                        <span
                                                            key={tag}
                                                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="p-4 text-sm text-muted-foreground">
                                                {customer.lastVisitAt ? (
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" />
                                                        {new Date(customer.lastVisitAt).toLocaleDateString('ja-JP')}
                                                    </div>
                                                ) : (
                                                    '-'
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        disabled={!pagination.hasPrev}
                        onClick={() => setCurrentPage(currentPage - 1)}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {pagination.page} / {pagination.totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="icon"
                        disabled={!pagination.hasNext}
                        onClick={() => setCurrentPage(currentPage + 1)}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}
