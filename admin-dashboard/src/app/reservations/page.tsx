"use client";

import { useState, useMemo, useEffect } from "react";
import {
    Search,
    Plus,
    Calendar,
    Clock,
    User,
    Phone,
    MoreHorizontal,
    CheckCircle,
    XCircle,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    RefreshCw,
    Loader2,
    Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format, addDays, startOfWeek, endOfWeek, isToday, isTomorrow, parseISO } from "date-fns";
import { ja } from "date-fns/locale";
import { reservationsApi, practitionersApi, menusApi } from "@/lib/api";

// 予約ステータスの定義
type ReservationStatus = "confirmed" | "pending" | "completed" | "canceled" | "no_show";

interface Reservation {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    customerName: string;
    customerPhone: string;
    menuName: string; // from menuNames[0]
    practitionerId: string;
    practitionerName: string;
    status: ReservationStatus;
    totalPrice: number;
    note?: string;
    createdAt: string;
}

const statusConfig: Record<ReservationStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
    confirmed: { label: "確定", color: "bg-green-100 text-green-700", icon: CheckCircle },
    pending: { label: "仮予約", color: "bg-yellow-100 text-yellow-700", icon: AlertCircle },
    completed: { label: "来店済", color: "bg-blue-100 text-blue-700", icon: CheckCircle },
    canceled: { label: "キャンセル", color: "bg-gray-100 text-gray-500", icon: XCircle },
    no_show: { label: "無断キャンセル", color: "bg-red-100 text-red-700", icon: XCircle },
};

interface PractitionerOption {
    id: string;
    name: string;
}

interface MenuOption {
    id: string;
    name: string;
}

export default function ReservationsPage() {
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [practitionerOptions, setPractitionerOptions] = useState<PractitionerOption[]>([
        { id: "all", name: "全スタッフ" },
    ]);
    const [menuOptions, setMenuOptions] = useState<MenuOption[]>([]);

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<ReservationStatus | "all">("all");
    const [practitionerFilter, setPractitionerFilter] = useState("all");
    const [currentDate, setCurrentDate] = useState(new Date());
    const [dateRange, setDateRange] = useState<"day" | "week" | "all">("all");
    const [showActionMenu, setShowActionMenu] = useState<string | null>(null);
    const [isUpdating, setIsUpdating] = useState<string | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [createForm, setCreateForm] = useState({
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        practitionerId: "",
        menuId: "",
        date: format(new Date(), "yyyy-MM-dd"),
        startTime: "10:00",
        isNomination: true,
    });

    // データ取得
    const fetchReservations = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await reservationsApi.list();
            if (res.success && Array.isArray(res.data)) {
                const formatted: Reservation[] = res.data.map((r: any) => ({
                    id: r.id,
                    date: r.date,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    customerName: r.customerName || 'ゲスト',
                    customerPhone: r.customerPhone || '',
                    menuName: r.menuNames?.[0] || 'メニュー未定',
                    practitionerId: r.practitionerId,
                    practitionerName: r.practitionerName,
                    status: r.status,
                    totalPrice: r.totalPrice,
                    note: r.customerNote,
                    createdAt: r.createdAt
                }));
                setReservations(formatted);
            } else {
                setError(res.error?.message || '予約データの取得に失敗しました');
            }
        } catch (err) {
            console.error(err);
            setError('予約データの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchReservations();
        const fetchOptions = async () => {
            const [pRes, mRes] = await Promise.all([
                practitionersApi.listAll(),
                menusApi.listAll(),
            ]);

            if (pRes.success && Array.isArray(pRes.data)) {
                const list = pRes.data as any[];
                setPractitionerOptions([
                    { id: "all", name: "全スタッフ" },
                    ...list.filter(p => p.isActive !== false).map(p => ({ id: p.id, name: p.name })),
                ]);
            }

            if (mRes.success && Array.isArray(mRes.data)) {
                const list = mRes.data as any[];
                setMenuOptions(list.filter(m => m.isActive !== false).map(m => ({ id: m.id, name: m.name })));
            }
        };

        fetchOptions();
    }, []);

    // ステータス変更
    const handleStatusChange = async (reservationId: string, newStatus: ReservationStatus, reason?: string) => {
        setIsUpdating(reservationId);
        setShowActionMenu(null);
        try {
            const res = await reservationsApi.updateStatus(reservationId, newStatus, reason);
            if (res.success) {
                // ローカル状態を更新
                setReservations(prev => prev.map(r =>
                    r.id === reservationId ? { ...r, status: newStatus } : r
                ));
            } else {
                setError(res.error?.message || 'ステータスの更新に失敗しました');
            }
        } catch (err) {
            console.error(err);
            setError('ステータスの更新に失敗しました');
        } finally {
            setIsUpdating(null);
        }
    };

    const handleCreateReservation = async () => {
        if (!createForm.customerName.trim()) {
            setError("顧客名を入力してください");
            return;
        }
        if (!createForm.practitionerId) {
            setError("施術者を選択してください");
            return;
        }
        if (!createForm.menuId) {
            setError("メニューを選択してください");
            return;
        }

        setIsCreating(true);
        setError(null);
        try {
            const payload = {
                customerName: createForm.customerName,
                customerPhone: createForm.customerPhone || undefined,
                customerEmail: createForm.customerEmail || undefined,
                practitionerId: createForm.practitionerId,
                menuIds: [createForm.menuId],
                optionIds: [],
                date: createForm.date,
                startTime: createForm.startTime,
                status: "confirmed",
                isNomination: createForm.isNomination,
                source: "admin",
            };

            const res = await reservationsApi.createAdmin(payload);
            if (!res.success) {
                throw new Error(res.error?.message || "予約作成に失敗しました");
            }

            setIsCreateModalOpen(false);
            setCreateForm({
                customerName: "",
                customerPhone: "",
                customerEmail: "",
                practitionerId: "",
                menuId: "",
                date: format(new Date(), "yyyy-MM-dd"),
                startTime: "10:00",
                isNomination: true,
            });
            fetchReservations();
        } catch (err: any) {
            setError(err.message || "予約作成に失敗しました");
        } finally {
            setIsCreating(false);
        }
    };

    // フィルタリングされた予約
    const filteredReservations = useMemo(() => {
        return reservations
            .filter((res) => {
                // 検索フィルター
                if (searchQuery) {
                    const query = searchQuery.toLowerCase();
                    if (
                        !res.customerName.toLowerCase().includes(query) &&
                        !res.customerPhone.includes(query) &&
                        !res.menuName.toLowerCase().includes(query)
                    ) {
                        return false;
                    }
                }

                // ステータスフィルター
                if (statusFilter !== "all" && res.status !== statusFilter) {
                    return false;
                }

                // スタッフフィルター
                if (practitionerFilter !== "all" && res.practitionerId !== practitionerFilter) {
                    return false;
                }

                // 日付フィルター
                if (dateRange === "day") {
                    const resDate = format(parseISO(res.date), "yyyy-MM-dd");
                    const targetDate = format(currentDate, "yyyy-MM-dd");
                    if (resDate !== targetDate) return false;
                } else if (dateRange === "week") {
                    const resDate = parseISO(res.date);
                    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
                    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
                    if (resDate < weekStart || resDate > weekEnd) return false;
                }

                return true;
            })
            .sort((a, b) => {
                // 日付・時間でソート
                const dateCompare = a.date.localeCompare(b.date);
                if (dateCompare !== 0) return dateCompare;
                return a.startTime.localeCompare(b.startTime);
            });
    }, [reservations, searchQuery, statusFilter, practitionerFilter, dateRange, currentDate]);

    // 統計データ
    const stats = useMemo(() => {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        const tomorrowStr = format(addDays(new Date(), 1), "yyyy-MM-dd");

        const todayReservations = reservations.filter(
            (r) => r.date === todayStr && r.status !== "canceled" && r.status !== "no_show"
        );
        const tomorrowReservations = reservations.filter(
            (r) => r.date === tomorrowStr && r.status !== "canceled" && r.status !== "no_show"
        );
        const pendingReservations = reservations.filter((r) => r.status === "pending");

        // 今月の売上 (簡易計算)
        const currentMonth = format(new Date(), "yyyy-MM");
        const thisMonthRevenue = reservations
            .filter((r) => r.date.startsWith(currentMonth) && r.status === "completed")
            .reduce((sum, r) => sum + r.totalPrice, 0);

        return {
            today: todayReservations.length,
            tomorrow: tomorrowReservations.length,
            pending: pendingReservations.length,
            monthRevenue: thisMonthRevenue,
        };
    }, [reservations]);

    const getDateLabel = (dateStr: string) => {
        const date = parseISO(dateStr);
        if (isToday(date)) return "今日";
        if (isTomorrow(date)) return "明日";
        return format(date, "M/d (E)", { locale: ja });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">予約一覧</h1>
                    <p className="text-muted-foreground">
                        予約の確認・管理ができます
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchReservations}>
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>
                    <Button onClick={() => setIsCreateModalOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        新規予約
                    </Button>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-muted-foreground">本日の予約</div>
                                <div className="text-2xl font-bold">{stats.today}件</div>
                            </div>
                            <Calendar className="h-8 w-8 text-primary opacity-80" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-muted-foreground">明日の予約</div>
                                <div className="text-2xl font-bold">{stats.tomorrow}件</div>
                            </div>
                            <Clock className="h-8 w-8 text-blue-500 opacity-80" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-muted-foreground">仮予約（未確定）</div>
                                <div className="text-2xl font-bold text-yellow-600">{stats.pending}件</div>
                            </div>
                            <AlertCircle className="h-8 w-8 text-yellow-500 opacity-80" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-muted-foreground">今月の売上</div>
                                <div className="text-2xl font-bold">¥{stats.monthRevenue.toLocaleString()}</div>
                            </div>
                            <div className="text-2xl">💰</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-center">
                        {/* Search */}
                        <div className="relative flex-1 min-w-[200px] max-w-md">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="顧客名・電話番号・メニューで検索..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Date Range */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant={dateRange === "all" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setDateRange("all")}
                            >
                                全期間
                            </Button>
                            <Button
                                variant={dateRange === "day" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setDateRange("day")}
                            >
                                日別
                            </Button>
                            <Button
                                variant={dateRange === "week" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setDateRange("week")}
                            >
                                週別
                            </Button>
                        </div>

                        {/* Date Navigation (visible when day/week selected) */}
                        {dateRange !== "all" && (
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setCurrentDate(addDays(currentDate, dateRange === "day" ? -1 : -7))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm font-medium min-w-[120px] text-center">
                                    {dateRange === "day"
                                        ? format(currentDate, "M月d日 (E)", { locale: ja })
                                        : `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), "M/d")} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), "M/d")}`
                                    }
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setCurrentDate(addDays(currentDate, dateRange === "day" ? 1 : 7))}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        )}

                        {/* Status Filter */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as ReservationStatus | "all")}
                            className="h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="all">全ステータス</option>
                            <option value="confirmed">確定</option>
                            <option value="pending">仮予約</option>
                            <option value="completed">来店済</option>
                            <option value="canceled">キャンセル</option>
                            <option value="no_show">無断キャンセル</option>
                        </select>

                        {/* Practitioner Filter */}
                        <select
                            value={practitionerFilter}
                            onChange={(e) => setPractitionerFilter(e.target.value)}
                            className="h-10 rounded-lg border border-gray-200 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            {practitionerOptions.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </CardContent>
            </Card>

            {/* Reservations Table */}
            <Card>
                <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">
                            予約一覧
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                                ({filteredReservations.length}件)
                            </span>
                        </CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-gray-50 text-left text-sm text-muted-foreground">
                                    <th className="px-4 py-3 font-medium">日時</th>
                                    <th className="px-4 py-3 font-medium">顧客</th>
                                    <th className="px-4 py-3 font-medium">メニュー</th>
                                    <th className="px-4 py-3 font-medium">担当</th>
                                    <th className="px-4 py-3 font-medium text-right">料金</th>
                                    <th className="px-4 py-3 font-medium">ステータス</th>
                                    <th className="px-4 py-3 font-medium w-12"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                                            読み込み中...
                                        </td>
                                    </tr>
                                ) : filteredReservations.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                                            条件に一致する予約がありません
                                        </td>
                                    </tr>
                                ) : (
                                    filteredReservations.map((reservation) => {
                                        const StatusIcon = statusConfig[reservation.status].icon;
                                        return (
                                            <tr
                                                key={reservation.id}
                                                className="border-b last:border-b-0 hover:bg-gray-50 transition-colors"
                                            >
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-center min-w-[60px]">
                                                            <div className="text-xs text-muted-foreground">
                                                                {getDateLabel(reservation.date)}
                                                            </div>
                                                            <div className="font-medium">
                                                                {reservation.startTime}
                                                            </div>
                                                        </div>
                                                        <div className="text-xs text-gray-400">
                                                            〜{reservation.endTime}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                                                            <User className="h-4 w-4 text-gray-500" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium">{reservation.customerName}</div>
                                                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                                <Phone className="h-3 w-3" />
                                                                {reservation.customerPhone}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="font-medium">{reservation.menuName}</div>
                                                    {reservation.note && (
                                                        <div className="text-xs text-muted-foreground mt-1">
                                                            📝 {reservation.note}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-sm">{reservation.practitionerName}</span>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <span className="font-medium">
                                                        ¥{reservation.totalPrice.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                                                            statusConfig[reservation.status].color
                                                        )}
                                                    >
                                                        <StatusIcon className="h-3 w-3" />
                                                        {statusConfig[reservation.status].label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="relative">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() =>
                                                                setShowActionMenu(
                                                                    showActionMenu === reservation.id ? null : reservation.id
                                                                )
                                                            }
                                                        >
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                        {showActionMenu === reservation.id && (
                                                            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border bg-white shadow-lg z-10">
                                                                {reservation.status === 'pending' && (
                                                                    <button
                                                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                                                                        onClick={() => handleStatusChange(reservation.id, 'confirmed')}
                                                                    >
                                                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                                                        確定する
                                                                    </button>
                                                                )}
                                                                {(reservation.status === 'confirmed' || reservation.status === 'pending') && (
                                                                    <button
                                                                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                                                                        onClick={() => handleStatusChange(reservation.id, 'completed')}
                                                                    >
                                                                        <Check className="h-4 w-4 text-blue-500" />
                                                                        来店済みにする
                                                                    </button>
                                                                )}
                                                                {reservation.status !== 'canceled' && reservation.status !== 'completed' && (
                                                                    <>
                                                                        <button
                                                                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-500"
                                                                            onClick={() => handleStatusChange(reservation.id, 'canceled')}
                                                                        >
                                                                            <XCircle className="h-4 w-4" />
                                                                            キャンセル
                                                                        </button>
                                                                        <button
                                                                            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-red-600"
                                                                            onClick={() => handleStatusChange(reservation.id, 'no_show')}
                                                                        >
                                                                            <XCircle className="h-4 w-4" />
                                                                            無断キャンセル
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}
                                                        {isUpdating === reservation.id && (
                                                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded">
                                                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                                            </div>
                                                        )}
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

            {/* Pagination (簡易版) */}
            {filteredReservations.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                        全 {filteredReservations.length} 件中 1-{filteredReservations.length} 件を表示
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled>
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            前へ
                        </Button>
                        <Button variant="outline" size="sm" disabled>
                            次へ
                            <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Create Reservation Dialog */}
            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>新規予約作成</DialogHeader>
                    <DialogBody className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">顧客名</label>
                            <input
                                value={createForm.customerName}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, customerName: e.target.value }))}
                                className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                placeholder="山田 太郎"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">電話番号</label>
                                <input
                                    value={createForm.customerPhone}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, customerPhone: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="090-1234-5678"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">メール</label>
                                <input
                                    type="email"
                                    value={createForm.customerEmail}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, customerEmail: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                    placeholder="info@example.com"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">施術者</label>
                                <select
                                    value={createForm.practitionerId}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, practitionerId: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                >
                                    <option value="">選択してください</option>
                                    {practitionerOptions.filter(p => p.id !== "all").map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">メニュー</label>
                                <select
                                    value={createForm.menuId}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, menuId: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                >
                                    <option value="">選択してください</option>
                                    {menuOptions.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">日付</label>
                                <input
                                    type="date"
                                    value={createForm.date}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, date: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">開始時間</label>
                                <input
                                    type="time"
                                    value={createForm.startTime}
                                    onChange={(e) => setCreateForm(prev => ({ ...prev, startTime: e.target.value }))}
                                    className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={createForm.isNomination}
                                onChange={(e) => setCreateForm(prev => ({ ...prev, isNomination: e.target.checked }))}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="text-sm">指名料を適用する</span>
                        </div>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                            キャンセル
                        </Button>
                        <Button onClick={handleCreateReservation} disabled={isCreating}>
                            {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            作成する
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
