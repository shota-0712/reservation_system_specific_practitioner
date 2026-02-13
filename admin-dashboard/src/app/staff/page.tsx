"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Edit2, Phone, Mail, Calendar, RefreshCw, AlertCircle, Trash2, Loader2, Link as LinkIcon, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, ConfirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { bookingLinksApi, getActiveStoreId, practitionersApi, STORE_CHANGED_EVENT } from "@/lib/api";

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

interface Schedule {
    workDays: number[]; // 0=日, 1=月, ... 6=土
    workHours: { start: string; end: string };
    breakTime?: { start: string; end: string };
}

interface Practitioner {
    id: string;
    name: string;
    nameKana?: string;
    role: 'stylist' | 'assistant' | 'owner';
    storeIds?: string[];
    phone?: string;
    email?: string;
    color?: string;
    lineConfig?: {
        liffId?: string;
        channelId?: string;
    };
    schedule?: Schedule;
    isActive: boolean;
    createdAt: string;
}

interface BookingLinkToken {
    id: string;
    practitionerId: string;
    storeId?: string;
    token: string;
    status: "active" | "revoked";
    createdAt: string;
    expiresAt?: string;
    lastUsedAt?: string;
}

const roleLabels: Record<string, { label: string; color: string }> = {
    stylist: { label: "スタイリスト", color: "bg-blue-100 text-blue-700" },
    assistant: { label: "アシスタント", color: "bg-purple-100 text-purple-700" },
    owner: { label: "オーナー", color: "bg-amber-100 text-amber-700" },
};

export default function StaffPage() {
    const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
    const [bookingLinks, setBookingLinks] = useState<BookingLinkToken[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showInactive, setShowInactive] = useState(false);
    const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
    const [linkLoadingByPractitioner, setLinkLoadingByPractitioner] = useState<Record<string, boolean>>({});

    // Modal states
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<Practitioner | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        name: "",
        nameKana: "",
        role: "stylist" as "stylist" | "assistant" | "owner",
        phone: "",
        email: "",
        color: "#3b82f6",
        isActive: true,
        workDays: [] as number[],
        workStart: "10:00",
        workEnd: "19:00",
        lineLiffId: "",
        lineChannelId: "",
        lineChannelAccessToken: "",
        lineChannelSecret: "",
    });

    const customerAppBaseUrl = useMemo(() => {
        const fromEnv = (process.env.NEXT_PUBLIC_CUSTOMER_URL || "").trim().replace(/\/+$/, "");
        if (fromEnv) return fromEnv;

        if (typeof window === "undefined") return "";

        const origin = window.location.origin;
        if (origin.includes("reserve-admin")) {
            return origin.replace("reserve-admin", "reserve-customer");
        }

        return "";
    }, []);

    const buildTokenBookingUrl = (token: string): string => {
        if (!customerAppBaseUrl) return "";
        try {
            const url = new URL(customerAppBaseUrl);
            url.searchParams.set("t", token);
            return url.toString();
        } catch {
            return "";
        }
    };

    const resolvePreferredStoreId = (practitioner: Practitioner): string | undefined => {
        const activeStoreId = getActiveStoreId();
        const staffStoreIds = (practitioner.storeIds || []).filter(Boolean);
        if (activeStoreId && (staffStoreIds.length === 0 || staffStoreIds.includes(activeStoreId))) {
            return activeStoreId;
        }
        return staffStoreIds[0] || undefined;
    };

    const getActiveLinkForPractitioner = (practitioner: Practitioner): BookingLinkToken | null => {
        const preferredStoreId = resolvePreferredStoreId(practitioner);
        const links = bookingLinks
            .filter((link) => link.practitionerId === practitioner.id && link.status === "active")
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        if (links.length === 0) {
            return null;
        }

        if (preferredStoreId) {
            const exact = links.find((link) => link.storeId === preferredStoreId);
            if (exact) return exact;
        }

        const tenantLevel = links.find((link) => !link.storeId);
        return tenantLevel || links[0] || null;
    };

    const withLinkLoading = (practitionerId: string, loading: boolean) => {
        setLinkLoadingByPractitioner((prev) => ({ ...prev, [practitionerId]: loading }));
    };

    const refreshBookingLinks = async () => {
        const response = await bookingLinksApi.list();
        if (response.success && response.data) {
            setBookingLinks(response.data as BookingLinkToken[]);
            return;
        }
        throw new Error(response.error?.message || "予約URL一覧の取得に失敗しました");
    };

    const issueBookingLink = async (practitioner: Practitioner, reissue: boolean) => {
        withLinkLoading(practitioner.id, true);
        try {
            const response = await bookingLinksApi.create({
                practitionerId: practitioner.id,
                storeId: resolvePreferredStoreId(practitioner),
                reissue,
            });
            if (!response.success || !response.data) {
                throw new Error(response.error?.message || "予約URLの発行に失敗しました");
            }
            await refreshBookingLinks();
        } finally {
            withLinkLoading(practitioner.id, false);
        }
    };

    const revokeBookingLink = async (practitioner: Practitioner, linkId: string) => {
        withLinkLoading(practitioner.id, true);
        try {
            const response = await bookingLinksApi.revoke(linkId);
            if (!response.success) {
                throw new Error(response.error?.message || "予約URLの無効化に失敗しました");
            }
            await refreshBookingLinks();
        } finally {
            withLinkLoading(practitioner.id, false);
        }
    };

    const copyPractitionerBookingUrl = async (link: BookingLinkToken) => {
        const url = buildTokenBookingUrl(link.token);
        if (!url) {
            alert("予約URLの生成に失敗しました。NEXT_PUBLIC_CUSTOMER_URL を設定してください。");
            return;
        }

        try {
            await navigator.clipboard.writeText(url);
            setCopiedLinkId(link.id);
            window.setTimeout(() => setCopiedLinkId((current) => (current === link.id ? null : current)), 1800);
        } catch (error) {
            console.error(error);
            alert("URLのコピーに失敗しました");
        }
    };

    // データ取得
    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [practitionerRes, bookingLinkRes] = await Promise.all([
                practitionersApi.listAll(),
                bookingLinksApi.list(),
            ]);

            if (!practitionerRes.success || !practitionerRes.data) {
                setError(practitionerRes.error?.message || 'スタッフデータの取得に失敗しました');
                return;
            }
            setPractitioners(practitionerRes.data as Practitioner[]);

            if (!bookingLinkRes.success || !bookingLinkRes.data) {
                setError(bookingLinkRes.error?.message || '予約URLデータの取得に失敗しました');
                return;
            }
            setBookingLinks(bookingLinkRes.data as BookingLinkToken[]);
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

    useEffect(() => {
        const onStoreChanged = () => {
            fetchData().catch(() => {
                // noop
            });
        };
        window.addEventListener(STORE_CHANGED_EVENT, onStoreChanged);
        return () => {
            window.removeEventListener(STORE_CHANGED_EVENT, onStoreChanged);
        };
    }, []);

    // Open create modal
    const handleCreate = () => {
        setSelectedStaff(null);
        setFormData({
            name: "",
            nameKana: "",
            role: "stylist",
            phone: "",
            email: "",
            color: "#3b82f6",
            isActive: true,
            workDays: [1, 2, 3, 4, 5], // Mon-Fri default
            workStart: "10:00",
            workEnd: "19:00",
            lineLiffId: "",
            lineChannelId: "",
            lineChannelAccessToken: "",
            lineChannelSecret: "",
        });
        setIsEditModalOpen(true);
    };

    // Open edit modal
    const handleEdit = (staff: Practitioner) => {
        setSelectedStaff(staff);
        setFormData({
            name: staff.name,
            nameKana: staff.nameKana || "",
            role: staff.role,
            phone: staff.phone || "",
            email: staff.email || "",
            color: staff.color || "#3b82f6",
            isActive: staff.isActive,
            workDays: staff.schedule?.workDays || [],
            workStart: staff.schedule?.workHours?.start || "10:00",
            workEnd: staff.schedule?.workHours?.end || "19:00",
            lineLiffId: staff.lineConfig?.liffId || "",
            lineChannelId: staff.lineConfig?.channelId || "",
            lineChannelAccessToken: "",
            lineChannelSecret: "",
        });
        setIsEditModalOpen(true);
    };

    // Open delete dialog
    const handleDeleteClick = (staff: Practitioner) => {
        setSelectedStaff(staff);
        setIsDeleteDialogOpen(true);
    };

    // Save (create or update)
    const handleSave = async () => {
        if (!formData.name.trim()) {
            alert("名前を入力してください");
            return;
        }

        setIsSaving(true);
        try {
            const data = {
                name: formData.name,
                nameKana: formData.nameKana || null,
                role: formData.role,
                phone: formData.phone || null,
                email: formData.email || null,
                color: formData.color,
                isActive: formData.isActive,
                schedule: {
                    workDays: formData.workDays,
                    workHours: { start: formData.workStart, end: formData.workEnd },
                },
                lineConfig: {
                    liffId: formData.lineLiffId || undefined,
                    channelId: formData.lineChannelId || undefined,
                    channelAccessToken: formData.lineChannelAccessToken || undefined,
                    channelSecret: formData.lineChannelSecret || undefined,
                },
            };

            if (selectedStaff) {
                // Update
                const res = await practitionersApi.update(selectedStaff.id, data);
                if (!res.success) throw new Error(res.error?.message || "更新に失敗しました");
            } else {
                // Create
                const res = await practitionersApi.create(data);
                if (!res.success) throw new Error(res.error?.message || "作成に失敗しました");
            }

            setIsEditModalOpen(false);
            fetchData();
        } catch (err: any) {
            alert(err.message || "保存に失敗しました");
        } finally {
            setIsSaving(false);
        }
    };

    // Delete
    const handleDelete = async () => {
        if (!selectedStaff) return;

        setIsSaving(true);
        try {
            const res = await practitionersApi.delete(selectedStaff.id);
            if (!res.success) throw new Error(res.error?.message || "削除に失敗しました");

            setIsDeleteDialogOpen(false);
            setSelectedStaff(null);
            fetchData();
        } catch (err: any) {
            alert(err.message || "削除に失敗しました");
        } finally {
            setIsSaving(false);
        }
    };

    // Toggle work day
    const toggleWorkDay = (day: number) => {
        setFormData(prev => ({
            ...prev,
            workDays: prev.workDays.includes(day)
                ? prev.workDays.filter(d => d !== day)
                : [...prev.workDays, day].sort(),
        }));
    };

    // フィルタされたスタッフ
    const filteredStaff = practitioners.filter(p => showInactive || p.isActive);

    // 統計
    const activeCount = practitioners.filter(p => p.isActive).length;
    const stylistCount = practitioners.filter(p => p.role === 'stylist' && p.isActive).length;
    const assistantCount = practitioners.filter(p => p.role === 'assistant' && p.isActive).length;

    // 今日出勤予定のスタッフ
    const today = new Date().getDay(); // 0=日曜
    const todayWorkingCount = practitioners.filter(
        p => p.isActive && p.schedule?.workDays?.includes(today)
    ).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">スタッフ管理</h1>
                    <p className="text-muted-foreground">
                        スタッフ情報と勤務シフトを管理します
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchData}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button onClick={handleCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        新規スタッフ
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

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">総スタッフ数</div>
                        <div className="text-2xl font-bold">{activeCount}名</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">スタイリスト</div>
                        <div className="text-2xl font-bold">{stylistCount}名</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">アシスタント</div>
                        <div className="text-2xl font-bold">{assistantCount}名</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">今日の出勤</div>
                        <div className="text-2xl font-bold text-green-600">{todayWorkingCount}名</div>
                    </CardContent>
                </Card>
            </div>

            {/* Filter */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                />
                非アクティブスタッフを表示
            </label>

            {/* Staff List */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    読み込み中...
                </div>
            ) : filteredStaff.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    スタッフが登録されていません
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {filteredStaff.map((staff) => {
                        const role = roleLabels[staff.role] || { label: staff.role, color: "bg-gray-100 text-gray-600" };
                        const activeLink = getActiveLinkForPractitioner(staff);
                        const bookingUrl = activeLink ? buildTokenBookingUrl(activeLink.token) : "";
                        const copied = activeLink ? copiedLinkId === activeLink.id : false;
                        const linkLoading = Boolean(linkLoadingByPractitioner[staff.id]);
                        return (
                            <Card key={staff.id} className={cn(!staff.isActive && "opacity-60")}>
                                <CardContent className="p-4">
                                    <div className="flex items-start gap-4">
                                        {/* Avatar */}
                                        <div
                                            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
                                            style={{ backgroundColor: staff.color || '#3b82f6' }}
                                        >
                                            {staff.name.charAt(0)}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="font-semibold">{staff.name}</h3>
                                                    {staff.nameKana && (
                                                        <span className="text-sm text-muted-foreground">
                                                            {staff.nameKana}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="icon" onClick={() => handleEdit(staff)}>
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="text-red-500" onClick={() => handleDeleteClick(staff)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <div className="mt-2 flex items-center gap-2">
                                                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", role.color)}>
                                                    {role.label}
                                                </span>
                                                {!staff.isActive && (
                                                    <span className="rounded-full bg-gray-200 text-gray-600 px-2 py-0.5 text-xs">
                                                        非アクティブ
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                                                {staff.phone && (
                                                    <div className="flex items-center gap-2">
                                                        <Phone className="h-3 w-3" />
                                                        {staff.phone}
                                                    </div>
                                                )}
                                                {staff.email && (
                                                    <div className="flex items-center gap-2">
                                                        <Mail className="h-3 w-3" />
                                                        {staff.email}
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-3 w-3" />
                                                    登録: {new Date(staff.createdAt).toLocaleDateString('ja-JP')}
                                                </div>
                                            </div>

                                            {/* Work Days */}
                                            {staff.schedule?.workDays && (
                                                <div className="mt-3">
                                                    <div className="text-xs text-muted-foreground mb-1">
                                                        出勤日
                                                    </div>
                                                    <div className="flex gap-1">
                                                        {DAYS.map((day, index) => (
                                                            <span
                                                                key={day}
                                                                className={cn(
                                                                    "w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium",
                                                                    staff.schedule?.workDays?.includes(index)
                                                                        ? "bg-primary text-white"
                                                                        : "bg-gray-100 text-gray-400"
                                                                )}
                                                            >
                                                                {day}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Work Hours */}
                                            {staff.schedule?.workHours && (
                                                <div className="mt-2 text-xs text-muted-foreground">
                                                    勤務時間: {staff.schedule.workHours.start} - {staff.schedule.workHours.end}
                                                </div>
                                            )}

                                            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2">
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                                                        <LinkIcon className="h-3 w-3" />
                                                        スタッフ別予約URL
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        {activeLink && (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-7 px-2 text-xs"
                                                                onClick={() => copyPractitionerBookingUrl(activeLink)}
                                                                disabled={!bookingUrl || linkLoading}
                                                            >
                                                                {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                                                                {copied ? "コピー済み" : "コピー"}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 px-2 text-xs"
                                                            onClick={() => issueBookingLink(staff, Boolean(activeLink)).catch((err: any) => alert(err?.message || "予約URLの発行に失敗しました"))}
                                                            disabled={linkLoading}
                                                        >
                                                            {linkLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                                            {activeLink ? "再発行" : "URL発行"}
                                                        </Button>
                                                        {activeLink && (
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-7 px-2 text-xs text-red-600"
                                                                onClick={() => revokeBookingLink(staff, activeLink.id).catch((err: any) => alert(err?.message || "予約URLの無効化に失敗しました"))}
                                                                disabled={linkLoading}
                                                            >
                                                                無効化
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                                {bookingUrl ? (
                                                    <>
                                                        <code className="block break-all text-[11px] text-gray-600">{bookingUrl}</code>
                                                        <div className="mt-1 text-[10px] text-gray-500">
                                                            token: {activeLink?.token}
                                                            {activeLink?.storeId ? ` / storeId: ${activeLink.storeId}` : " / store: tenant-default"}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <p className="text-[11px] text-muted-foreground">
                                                        まだURLが発行されていません。「URL発行」を押してください。
                                                    </p>
                                                )}
                                                {!customerAppBaseUrl && (
                                                    <p className="mt-1 text-[11px] text-amber-600">
                                                        NEXT_PUBLIC_CUSTOMER_URL 未設定のためコピーできません。
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Edit/Create Modal */}
            <Dialog open={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}>
                <DialogContent className="max-w-md">
                    <DialogHeader onClose={() => setIsEditModalOpen(false)}>
                        {selectedStaff ? "スタッフ編集" : "新規スタッフ"}
                    </DialogHeader>
                    <DialogBody className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">名前 *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                placeholder="山田 太郎"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">フリガナ</label>
                            <input
                                type="text"
                                value={formData.nameKana}
                                onChange={(e) => setFormData({ ...formData, nameKana: e.target.value })}
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                placeholder="ヤマダ タロウ"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">役職</label>
                            <select
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                            >
                                <option value="stylist">スタイリスト</option>
                                <option value="assistant">アシスタント</option>
                                <option value="owner">オーナー</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">電話番号</label>
                                <input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                    placeholder="090-1234-5678"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">メール</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                    placeholder="staff@salon.com"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">カラー</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={formData.color}
                                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                                    className="w-10 h-10 rounded cursor-pointer"
                                />
                                <span className="text-sm text-muted-foreground">{formData.color}</span>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">出勤曜日</label>
                            <div className="flex gap-1">
                                {DAYS.map((day, index) => (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => toggleWorkDay(index)}
                                        className={cn(
                                            "w-9 h-9 rounded-full text-sm font-medium transition-colors",
                                            formData.workDays.includes(index)
                                                ? "bg-primary text-white"
                                                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                        )}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">勤務開始</label>
                                <input
                                    type="time"
                                    value={formData.workStart}
                                    onChange={(e) => setFormData({ ...formData, workStart: e.target.value })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">勤務終了</label>
                                <input
                                    type="time"
                                    value={formData.workEnd}
                                    onChange={(e) => setFormData({ ...formData, workEnd: e.target.value })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                />
                            </div>
                        </div>
                        <div className="rounded-lg border border-gray-200 p-3">
                            <div className="mb-2 text-sm font-medium">LINE設定（施術者別）</div>
                            <p className="mb-3 text-xs text-muted-foreground">
                                設定画面で「施術者ごと」を選択した場合に使用されます。未入力項目は店舗共通設定を利用します。
                            </p>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium mb-1">LIFF ID</label>
                                    <input
                                        type="text"
                                        value={formData.lineLiffId}
                                        onChange={(e) => setFormData({ ...formData, lineLiffId: e.target.value })}
                                        className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                        placeholder="200xxxxxxxxx"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Channel ID</label>
                                    <input
                                        type="text"
                                        value={formData.lineChannelId}
                                        onChange={(e) => setFormData({ ...formData, lineChannelId: e.target.value })}
                                        className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                        placeholder="1234567890"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Channel Access Token（更新時のみ入力）</label>
                                    <input
                                        type="password"
                                        value={formData.lineChannelAccessToken}
                                        onChange={(e) => setFormData({ ...formData, lineChannelAccessToken: e.target.value })}
                                        className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                        placeholder="未入力なら既存値を保持"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Channel Secret（更新時のみ入力）</label>
                                    <input
                                        type="password"
                                        value={formData.lineChannelSecret}
                                        onChange={(e) => setFormData({ ...formData, lineChannelSecret: e.target.value })}
                                        className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                        placeholder="未入力なら既存値を保持"
                                    />
                                </div>
                            </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="text-sm">アクティブ</span>
                        </label>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isSaving}>
                            キャンセル
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {selectedStaff ? "更新" : "作成"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <ConfirmDialog
                open={isDeleteDialogOpen}
                onClose={() => setIsDeleteDialogOpen(false)}
                onConfirm={handleDelete}
                title="スタッフを削除"
                description={`「${selectedStaff?.name}」を削除してもよろしいですか？この操作は取り消せません。`}
                confirmText="削除"
                cancelText="キャンセル"
                variant="danger"
                loading={isSaving}
            />
        </div>
    );
}
