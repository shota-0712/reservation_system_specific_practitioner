"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { storesApi, STORES_UPDATED_EVENT } from "@/lib/api";

interface StoreItem {
    id: string;
    storeCode: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    slotDuration?: number;
    advanceBookingDays?: number;
    cancelDeadlineHours?: number;
    status?: "active" | "inactive";
}

export default function StoresPage() {
    const { pushToast } = useToast();
    const [stores, setStores] = useState<StoreItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<StoreItem | null>(null);
    const [formError, setFormError] = useState<string | null>(null);

    const [form, setForm] = useState({
        storeCode: "",
        name: "",
        address: "",
        phone: "",
        email: "",
        timezone: "Asia/Tokyo",
        slotDuration: 30,
        advanceBookingDays: 30,
        cancelDeadlineHours: 24,
        status: "active" as "active" | "inactive",
    });

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await storesApi.list();
            if (res.success && Array.isArray(res.data)) {
                setStores(res.data as StoreItem[]);
            } else {
                setError(res.error?.message || "店舗一覧の取得に失敗しました");
            }
        } catch (err) {
            console.error(err);
            setError("店舗一覧の取得に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const openCreate = () => {
        setSelected(null);
        setFormError(null);
        setForm({
            storeCode: "",
            name: "",
            address: "",
            phone: "",
            email: "",
            timezone: "Asia/Tokyo",
            slotDuration: 30,
            advanceBookingDays: 30,
            cancelDeadlineHours: 24,
            status: "active",
        });
        setIsEditOpen(true);
    };

    const openEdit = (store: StoreItem) => {
        setSelected(store);
        setFormError(null);
        setForm({
            storeCode: store.storeCode,
            name: store.name,
            address: store.address || "",
            phone: store.phone || "",
            email: store.email || "",
            timezone: store.timezone || "Asia/Tokyo",
            slotDuration: store.slotDuration ?? 30,
            advanceBookingDays: store.advanceBookingDays ?? 30,
            cancelDeadlineHours: store.cancelDeadlineHours ?? 24,
            status: store.status || "active",
        });
        setIsEditOpen(true);
    };

    const validateStoreCode = (value: string) => /^[a-z0-9]{8,10}$/.test(value);

    const save = async () => {
        setFormError(null);
        if (!form.name.trim()) {
            setFormError("店舗名を入力してください");
            pushToast({ variant: "warning", title: "入力内容を確認してください", description: "店舗名は必須です。" });
            return;
        }
        if (!selected && !validateStoreCode(form.storeCode)) {
            setFormError("店舗コードは8-10文字の小文字英数字で入力してください");
            pushToast({ variant: "warning", title: "入力内容を確認してください", description: "店舗コード形式が不正です。" });
            return;
        }

        setSaving(true);
        setError(null);
        try {
            if (selected) {
                const updatePayload = {
                    name: form.name.trim(),
                    address: form.address || undefined,
                    phone: form.phone || undefined,
                    email: form.email || undefined,
                    timezone: form.timezone,
                    slotDuration: Number(form.slotDuration),
                    advanceBookingDays: Number(form.advanceBookingDays),
                    cancelDeadlineHours: Number(form.cancelDeadlineHours),
                    status: form.status,
                };
                const res = await storesApi.update(selected.id, updatePayload);
                if (!res.success) throw new Error(res.error?.message || "店舗更新に失敗しました");
            } else {
                const createPayload = {
                    storeCode: form.storeCode,
                    name: form.name.trim(),
                    address: form.address || undefined,
                    phone: form.phone || undefined,
                    email: form.email || undefined,
                    timezone: form.timezone,
                    slotDuration: Number(form.slotDuration),
                    advanceBookingDays: Number(form.advanceBookingDays),
                    cancelDeadlineHours: Number(form.cancelDeadlineHours),
                    status: form.status,
                };
                const res = await storesApi.create(createPayload);
                if (!res.success) throw new Error(res.error?.message || "店舗作成に失敗しました");
            }

            setIsEditOpen(false);
            pushToast({
                variant: "success",
                title: selected ? "店舗を更新しました" : "店舗を作成しました",
            });
            window.dispatchEvent(new CustomEvent(STORES_UPDATED_EVENT));
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "店舗保存に失敗しました");
            pushToast({
                variant: "error",
                title: "店舗保存に失敗しました",
                description: err.message || "店舗保存に失敗しました",
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!selected) return;
        setSaving(true);
        setError(null);
        try {
            const res = await storesApi.delete(selected.id);
            if (!res.success) {
                throw new Error(res.error?.message || "店舗削除に失敗しました");
            }
            setIsDeleteOpen(false);
            setSelected(null);
            pushToast({
                variant: "success",
                title: "店舗を削除しました",
            });
            window.dispatchEvent(new CustomEvent(STORES_UPDATED_EVENT));
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "店舗削除に失敗しました");
            pushToast({
                variant: "error",
                title: "店舗削除に失敗しました",
                description: err.message || "店舗削除に失敗しました",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">店舗管理</h1>
                    <p className="text-muted-foreground">店舗設定と予約ポリシーを管理します</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchData}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button onClick={openCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        新規店舗
                    </Button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>店舗一覧</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="h-40 flex items-center justify-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : stores.length === 0 ? (
                        <div className="h-40 flex items-center justify-center text-muted-foreground">店舗がありません</div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b text-left text-sm text-muted-foreground">
                                    <th className="p-4 font-medium">店舗</th>
                                    <th className="p-4 font-medium">連絡先</th>
                                    <th className="p-4 font-medium">予約設定</th>
                                    <th className="p-4 font-medium">状態</th>
                                    <th className="p-4 font-medium text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stores.map((store) => (
                                    <tr key={store.id} className="border-b last:border-b-0 hover:bg-gray-50">
                                        <td className="p-4">
                                            <div className="font-medium">{store.name}</div>
                                            <div className="text-xs text-muted-foreground mt-1">code: {store.storeCode}</div>
                                            {store.address && <div className="text-xs text-muted-foreground mt-1">{store.address}</div>}
                                        </td>
                                        <td className="p-4 text-sm text-muted-foreground">
                                            <div>{store.phone || "-"}</div>
                                            <div>{store.email || "-"}</div>
                                            <div>{store.timezone || "Asia/Tokyo"}</div>
                                        </td>
                                        <td className="p-4 text-sm text-muted-foreground">
                                            <div>slot: {store.slotDuration ?? 30}分</div>
                                            <div>先行予約: {store.advanceBookingDays ?? 30}日</div>
                                            <div>キャンセル期限: {store.cancelDeadlineHours ?? 24}時間</div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${(store.status || "active") === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                                {(store.status || "active") === "active" ? "稼働中" : "停止"}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" onClick={() => openEdit(store)}>
                                                    <Edit2 className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelected(store);
                                                        setIsDeleteOpen(true);
                                                    }}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>{selected ? "店舗編集" : "店舗作成"}</DialogHeader>
                    <DialogBody className="space-y-3">
                        {formError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {formError}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">店舗名</label>
                                <input
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                value={form.name}
                                onChange={(e) => {
                                    setForm((prev) => ({ ...prev, name: e.target.value }));
                                    if (formError) setFormError(null);
                                }}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">店舗コード</label>
                                <input
                                    disabled={!!selected}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm disabled:bg-gray-100"
                                    placeholder="例: tokyo001"
                                value={form.storeCode}
                                onChange={(e) => {
                                    setForm((prev) => ({ ...prev, storeCode: e.target.value }));
                                    if (formError) setFormError(null);
                                }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">電話番号</label>
                                <input
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.phone}
                                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">メール</label>
                                <input
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.email}
                                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium">住所</label>
                            <input
                                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                value={form.address}
                                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">タイムゾーン</label>
                                <input
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.timezone}
                                    onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">状態</label>
                                <select
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.status}
                                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as "active" | "inactive" }))}
                                >
                                    <option value="active">active</option>
                                    <option value="inactive">inactive</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-sm font-medium">枠間隔 (分)</label>
                                <input
                                    type="number"
                                    min={5}
                                    max={120}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.slotDuration}
                                    onChange={(e) => setForm((prev) => ({ ...prev, slotDuration: Number(e.target.value) }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">先行予約 (日)</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.advanceBookingDays}
                                    onChange={(e) => setForm((prev) => ({ ...prev, advanceBookingDays: Number(e.target.value) }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">キャンセル期限 (時間)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={168}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.cancelDeadlineHours}
                                    onChange={(e) => setForm((prev) => ({ ...prev, cancelDeadlineHours: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={saving}>キャンセル</Button>
                        <Button onClick={save} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={isDeleteOpen}
                onClose={() => setIsDeleteOpen(false)}
                onConfirm={remove}
                title="店舗を削除"
                description={`「${selected?.name || "この店舗"}」を削除しますか？`}
                confirmText="削除"
                variant="danger"
                loading={saving}
            />
        </div>
    );
}
