"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, ConfirmDialog } from "@/components/ui/dialog";
import { menusApi, optionsApi } from "@/lib/api";

interface OptionItem {
    id: string;
    name: string;
    description?: string;
    duration: number;
    price: number;
    applicableMenuIds?: string[];
    isActive: boolean;
    displayOrder?: number;
}

interface MenuItem {
    id: string;
    name: string;
}

export default function OptionsPage() {
    const [items, setItems] = useState<OptionItem[]>([]);
    const [menus, setMenus] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<OptionItem | null>(null);

    const [form, setForm] = useState({
        name: "",
        description: "",
        duration: 0,
        price: 0,
        applicableMenuIdsText: "",
        isActive: true,
    });

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [optionsRes, menusRes] = await Promise.all([optionsApi.list(), menusApi.listAll()]);
            if (optionsRes.success && Array.isArray(optionsRes.data)) {
                setItems(optionsRes.data as OptionItem[]);
            } else {
                setError(optionsRes.error?.message || "オプションの取得に失敗しました");
            }

            if (menusRes.success && Array.isArray(menusRes.data)) {
                const activeMenus = (menusRes.data as any[])
                    .filter((m) => m.isActive !== false)
                    .map((m) => ({ id: m.id as string, name: m.name as string }));
                setMenus(activeMenus);
            }
        } catch (err) {
            console.error(err);
            setError("オプションの取得に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const openCreate = () => {
        setSelected(null);
        setForm({
            name: "",
            description: "",
            duration: 0,
            price: 0,
            applicableMenuIdsText: "",
            isActive: true,
        });
        setIsEditOpen(true);
    };

    const openEdit = (item: OptionItem) => {
        setSelected(item);
        setForm({
            name: item.name,
            description: item.description || "",
            duration: item.duration,
            price: item.price,
            applicableMenuIdsText: (item.applicableMenuIds || []).join(","),
            isActive: item.isActive,
        });
        setIsEditOpen(true);
    };

    const menuIdSet = useMemo(() => new Set(menus.map((m) => m.id)), [menus]);

    const parseMenuIds = () => {
        const ids = form.applicableMenuIdsText
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
        return ids.filter((id) => menuIdSet.size === 0 || menuIdSet.has(id));
    };

    const save = async () => {
        if (!form.name.trim()) {
            alert("オプション名を入力してください");
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                name: form.name.trim(),
                description: form.description || undefined,
                duration: Number(form.duration) || 0,
                price: Number(form.price) || 0,
                applicableMenuIds: parseMenuIds(),
                isActive: form.isActive,
            };

            const res = selected
                ? await optionsApi.update(selected.id, payload)
                : await optionsApi.create(payload);

            if (!res.success) {
                throw new Error(res.error?.message || "保存に失敗しました");
            }

            setIsEditOpen(false);
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "保存に失敗しました");
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!selected) return;
        setSaving(true);
        setError(null);
        try {
            const res = await optionsApi.delete(selected.id);
            if (!res.success) {
                throw new Error(res.error?.message || "削除に失敗しました");
            }
            setIsDeleteOpen(false);
            setSelected(null);
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "削除に失敗しました");
        } finally {
            setSaving(false);
        }
    };

    const menuNameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const menu of menus) m.set(menu.id, menu.name);
        return m;
    }, [menus]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">オプション管理</h1>
                    <p className="text-muted-foreground">追加オプションと料金を管理します</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchData}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                    <Button onClick={openCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        新規オプション
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
                    <CardTitle>オプション一覧</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="h-40 flex items-center justify-center text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="h-40 flex items-center justify-center text-muted-foreground">
                            オプションがありません
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b text-left text-sm text-muted-foreground">
                                    <th className="p-4 font-medium">名称</th>
                                    <th className="p-4 font-medium text-right">時間</th>
                                    <th className="p-4 font-medium text-right">価格</th>
                                    <th className="p-4 font-medium">対象メニュー</th>
                                    <th className="p-4 font-medium">状態</th>
                                    <th className="p-4 font-medium text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => {
                                    const menuNames = (item.applicableMenuIds || [])
                                        .map((id) => menuNameMap.get(id) || id)
                                        .join(", ");

                                    return (
                                        <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                                            <td className="p-4">
                                                <div className="font-medium">{item.name}</div>
                                                {item.description && (
                                                    <div className="text-xs text-muted-foreground mt-1">{item.description}</div>
                                                )}
                                            </td>
                                            <td className="p-4 text-right">{item.duration}分</td>
                                            <td className="p-4 text-right">¥{item.price.toLocaleString()}</td>
                                            <td className="p-4 text-sm text-muted-foreground">{menuNames || "全メニュー"}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                                    {item.isActive ? "有効" : "無効"}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                                                        <Edit2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => {
                                                            setSelected(item);
                                                            setIsDeleteOpen(true);
                                                        }}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>{selected ? "オプション編集" : "オプション作成"}</DialogHeader>
                    <DialogBody className="space-y-3">
                        <div>
                            <label className="text-sm font-medium">名称</label>
                            <input
                                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                value={form.name}
                                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium">説明</label>
                            <textarea
                                className="mt-1 w-full border rounded-md px-3 py-2 text-sm min-h-[80px]"
                                value={form.description}
                                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">追加時間 (分)</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.duration}
                                    onChange={(e) => setForm((prev) => ({ ...prev, duration: Number(e.target.value) }))}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium">追加料金 (円)</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                    value={form.price}
                                    onChange={(e) => setForm((prev) => ({ ...prev, price: Number(e.target.value) }))}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium">対象メニューID (カンマ区切り)</label>
                            <input
                                className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
                                placeholder="未入力なら全メニュー"
                                value={form.applicableMenuIdsText}
                                onChange={(e) => setForm((prev) => ({ ...prev, applicableMenuIdsText: e.target.value }))}
                            />
                            {menus.length > 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    利用可能: {menus.map((m) => `${m.name}(${m.id})`).join(" / ")}
                                </p>
                            )}
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                            />
                            有効化する
                        </label>
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
                title="オプションを削除"
                description={`「${selected?.name || "このオプション"}」を削除しますか？`}
                confirmText="削除"
                variant="danger"
                loading={saving}
            />
        </div>
    );
}
