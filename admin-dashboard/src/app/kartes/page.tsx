"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Edit2, FileText, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { karteTemplatesApi, kartesApi } from "@/lib/api";

interface KarteItem {
    id: string;
    customerId: string;
    customerName?: string;
    practitionerId: string;
    visitDate: string;
    menuNames?: string[];
    totalAmount?: number;
    status: "draft" | "completed";
    tags?: string[];
}

interface KarteTemplateItem {
    id: string;
    name: string;
    description?: string;
    isDefault: boolean;
    isActive: boolean;
    displayOrder: number;
}

export default function KartesPage() {
    const { pushToast } = useToast();
    const [kartes, setKartes] = useState<KarteItem[]>([]);
    const [templates, setTemplates] = useState<KarteTemplateItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [selectedKarte, setSelectedKarte] = useState<KarteItem | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<KarteTemplateItem | null>(null);
    const [isKarteDialogOpen, setIsKarteDialogOpen] = useState(false);
    const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<"karte" | "template">("karte");
    const [karteFormError, setKarteFormError] = useState<string | null>(null);
    const [templateFormError, setTemplateFormError] = useState<string | null>(null);

    const [karteForm, setKarteForm] = useState({
        customerId: "",
        customerName: "",
        practitionerId: "",
        visitDate: "",
        menuIds: "",
        menuNames: "",
        optionIds: "",
        totalAmount: 0,
        treatmentDescription: "",
        tags: "",
        status: "draft" as "draft" | "completed",
    });

    const [templateForm, setTemplateForm] = useState({
        name: "",
        description: "",
        isDefault: false,
        isActive: true,
        displayOrder: 0,
        applicableMenuCategories: "",
    });

    const splitCsv = (text: string) =>
        text
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [kartesRes, templatesRes] = await Promise.all([
                kartesApi.list({ limit: 200 }),
                karteTemplatesApi.list(),
            ]);

            if (kartesRes.success && Array.isArray(kartesRes.data)) {
                setKartes(kartesRes.data as KarteItem[]);
            } else {
                throw new Error(kartesRes.error?.message || "カルテ一覧の取得に失敗しました");
            }

            if (templatesRes.success && Array.isArray(templatesRes.data)) {
                setTemplates(templatesRes.data as KarteTemplateItem[]);
            } else {
                throw new Error(templatesRes.error?.message || "テンプレート一覧の取得に失敗しました");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "カルテデータの取得に失敗しました");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const openKarteCreate = () => {
        setSelectedKarte(null);
        setKarteFormError(null);
        setKarteForm({
            customerId: "",
            customerName: "",
            practitionerId: "",
            visitDate: new Date().toISOString().slice(0, 10),
            menuIds: "",
            menuNames: "",
            optionIds: "",
            totalAmount: 0,
            treatmentDescription: "",
            tags: "",
            status: "draft",
        });
        setIsKarteDialogOpen(true);
    };

    const openKarteEdit = (item: KarteItem) => {
        setSelectedKarte(item);
        setKarteFormError(null);
        setKarteForm({
            customerId: item.customerId,
            customerName: item.customerName || "",
            practitionerId: item.practitionerId,
            visitDate: item.visitDate,
            menuIds: "",
            menuNames: (item.menuNames || []).join(","),
            optionIds: "",
            totalAmount: item.totalAmount || 0,
            treatmentDescription: "",
            tags: (item.tags || []).join(","),
            status: item.status,
        });
        setIsKarteDialogOpen(true);
    };

    const saveKarte = async () => {
        setKarteFormError(null);
        if (!karteForm.customerId || !karteForm.practitionerId || !karteForm.visitDate) {
            setKarteFormError("customerId / practitionerId / visitDate は必須です");
            pushToast({
                variant: "warning",
                title: "入力内容を確認してください",
                description: "customerId / practitionerId / visitDate は必須です。",
            });
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                customerId: karteForm.customerId,
                customerName: karteForm.customerName || undefined,
                practitionerId: karteForm.practitionerId,
                visitDate: karteForm.visitDate,
                menuIds: splitCsv(karteForm.menuIds),
                menuNames: splitCsv(karteForm.menuNames),
                optionIds: splitCsv(karteForm.optionIds),
                totalAmount: Number(karteForm.totalAmount) || 0,
                treatmentDescription: karteForm.treatmentDescription || undefined,
                tags: splitCsv(karteForm.tags),
                status: karteForm.status,
            };

            const res = selectedKarte
                ? await kartesApi.update(selectedKarte.id, payload)
                : await kartesApi.create(payload);

            if (!res.success) {
                throw new Error(res.error?.message || "カルテ保存に失敗しました");
            }

            setIsKarteDialogOpen(false);
            pushToast({
                variant: "success",
                title: selectedKarte ? "カルテを更新しました" : "カルテを作成しました",
            });
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "カルテ保存に失敗しました");
            pushToast({
                variant: "error",
                title: "カルテ保存に失敗しました",
                description: err.message || "カルテ保存に失敗しました",
            });
        } finally {
            setSaving(false);
        }
    };

    const openTemplateCreate = () => {
        setSelectedTemplate(null);
        setTemplateFormError(null);
        setTemplateForm({
            name: "",
            description: "",
            isDefault: false,
            isActive: true,
            displayOrder: 0,
            applicableMenuCategories: "",
        });
        setIsTemplateDialogOpen(true);
    };

    const openTemplateEdit = (item: KarteTemplateItem) => {
        setSelectedTemplate(item);
        setTemplateFormError(null);
        setTemplateForm({
            name: item.name,
            description: item.description || "",
            isDefault: item.isDefault,
            isActive: item.isActive,
            displayOrder: item.displayOrder,
            applicableMenuCategories: "",
        });
        setIsTemplateDialogOpen(true);
    };

    const saveTemplate = async () => {
        setTemplateFormError(null);
        if (!templateForm.name.trim()) {
            setTemplateFormError("テンプレート名は必須です");
            pushToast({
                variant: "warning",
                title: "入力内容を確認してください",
                description: "テンプレート名は必須です。",
            });
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                name: templateForm.name.trim(),
                description: templateForm.description || undefined,
                isDefault: templateForm.isDefault,
                isActive: templateForm.isActive,
                displayOrder: Number(templateForm.displayOrder) || 0,
                applicableMenuCategories: splitCsv(templateForm.applicableMenuCategories),
                fields: [],
            };

            const res = selectedTemplate
                ? await karteTemplatesApi.update(selectedTemplate.id, payload)
                : await karteTemplatesApi.create(payload);

            if (!res.success) {
                throw new Error(res.error?.message || "テンプレート保存に失敗しました");
            }

            setIsTemplateDialogOpen(false);
            pushToast({
                variant: "success",
                title: selectedTemplate ? "テンプレートを更新しました" : "テンプレートを作成しました",
            });
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "テンプレート保存に失敗しました");
            pushToast({
                variant: "error",
                title: "テンプレート保存に失敗しました",
                description: err.message || "テンプレート保存に失敗しました",
            });
        } finally {
            setSaving(false);
        }
    };

    const openDelete = (target: "karte" | "template", item: KarteItem | KarteTemplateItem) => {
        setDeleteTarget(target);
        if (target === "karte") {
            setSelectedKarte(item as KarteItem);
            setSelectedTemplate(null);
        } else {
            setSelectedTemplate(item as KarteTemplateItem);
            setSelectedKarte(null);
        }
        setIsDeleteDialogOpen(true);
    };

    const remove = async () => {
        setSaving(true);
        setError(null);
        try {
            if (deleteTarget === "karte") {
                if (!selectedKarte) return;
                const res = await kartesApi.delete(selectedKarte.id);
                if (!res.success) throw new Error(res.error?.message || "カルテ削除に失敗しました");
            } else {
                if (!selectedTemplate) return;
                const res = await karteTemplatesApi.delete(selectedTemplate.id);
                if (!res.success) throw new Error(res.error?.message || "テンプレート削除に失敗しました");
            }
            setIsDeleteDialogOpen(false);
            pushToast({
                variant: "success",
                title: deleteTarget === "karte" ? "カルテを削除しました" : "テンプレートを削除しました",
            });
            await fetchData();
        } catch (err: any) {
            console.error(err);
            setError(err.message || "削除に失敗しました");
            pushToast({
                variant: "error",
                title: "削除に失敗しました",
                description: err.message || "削除に失敗しました",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">カルテ管理</h1>
                    <p className="text-muted-foreground">施術カルテとテンプレートを管理します</p>
                </div>
                <Button variant="outline" size="icon" onClick={fetchData}>
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    {error}
                </div>
            )}

            <Tabs defaultValue="kartes">
                <TabsList>
                    <TabsTrigger value="kartes">カルテ</TabsTrigger>
                    <TabsTrigger value="templates">テンプレート</TabsTrigger>
                </TabsList>

                <TabsContent value="kartes">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>カルテ一覧</CardTitle>
                            <Button onClick={openKarteCreate}>
                                <Plus className="mr-2 h-4 w-4" />
                                カルテ作成
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            {loading ? (
                                <div className="h-40 flex items-center justify-center text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                </div>
                            ) : kartes.length === 0 ? (
                                <div className="h-40 flex items-center justify-center text-muted-foreground">カルテがありません</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b text-left text-sm text-muted-foreground">
                                            <th className="p-4 font-medium">顧客</th>
                                            <th className="p-4 font-medium">来店日</th>
                                            <th className="p-4 font-medium">メニュー</th>
                                            <th className="p-4 font-medium text-right">金額</th>
                                            <th className="p-4 font-medium">状態</th>
                                            <th className="p-4 font-medium text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {kartes.map((item) => (
                                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                                                <td className="p-4">
                                                    <div className="font-medium">{item.customerName || item.customerId}</div>
                                                    <div className="text-xs text-muted-foreground mt-1">{item.id}</div>
                                                </td>
                                                <td className="p-4">{item.visitDate}</td>
                                                <td className="p-4 text-sm text-muted-foreground">
                                                    {(item.menuNames || []).join(" / ") || "-"}
                                                </td>
                                                <td className="p-4 text-right">¥{(item.totalAmount || 0).toLocaleString()}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === "completed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                                                        {item.status === "completed" ? "completed" : "draft"}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="outline" size="sm" onClick={() => openKarteEdit(item)}>
                                                            <Edit2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button variant="outline" size="sm" onClick={() => openDelete("karte", item)}>
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
                </TabsContent>

                <TabsContent value="templates">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>テンプレート一覧</CardTitle>
                            <Button onClick={openTemplateCreate}>
                                <Plus className="mr-2 h-4 w-4" />
                                テンプレート作成
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            {loading ? (
                                <div className="h-40 flex items-center justify-center text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                </div>
                            ) : templates.length === 0 ? (
                                <div className="h-40 flex items-center justify-center text-muted-foreground">テンプレートがありません</div>
                            ) : (
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b text-left text-sm text-muted-foreground">
                                            <th className="p-4 font-medium">名称</th>
                                            <th className="p-4 font-medium">説明</th>
                                            <th className="p-4 font-medium">状態</th>
                                            <th className="p-4 font-medium text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {templates.map((item) => (
                                            <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                                                <td className="p-4">
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground mt-1">order: {item.displayOrder}</div>
                                                </td>
                                                <td className="p-4 text-sm text-muted-foreground">{item.description || "-"}</td>
                                                <td className="p-4">
                                                    <div className="flex gap-2">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                                            {item.isActive ? "active" : "inactive"}
                                                        </span>
                                                        {item.isDefault && (
                                                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">default</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="outline" size="sm" onClick={() => openTemplateEdit(item)}>
                                                            <Edit2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button variant="outline" size="sm" onClick={() => openDelete("template", item)}>
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
                </TabsContent>
            </Tabs>

            <Dialog open={isKarteDialogOpen} onOpenChange={setIsKarteDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>{selectedKarte ? "カルテ編集" : "カルテ作成"}</DialogHeader>
                    <DialogBody className="space-y-3">
                        {karteFormError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {karteFormError}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">customerId *</label>
                                <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.customerId} onChange={(e) => {
                                    setKarteForm((p) => ({ ...p, customerId: e.target.value }));
                                    if (karteFormError) setKarteFormError(null);
                                }} />
                            </div>
                            <div>
                                <label className="text-sm font-medium">customerName</label>
                                <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.customerName} onChange={(e) => setKarteForm((p) => ({ ...p, customerName: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">practitionerId *</label>
                                <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.practitionerId} onChange={(e) => setKarteForm((p) => ({ ...p, practitionerId: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-sm font-medium">visitDate *</label>
                                <input type="date" className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.visitDate} onChange={(e) => setKarteForm((p) => ({ ...p, visitDate: e.target.value }))} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">menuNames (CSV)</label>
                                <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.menuNames} onChange={(e) => setKarteForm((p) => ({ ...p, menuNames: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-sm font-medium">totalAmount</label>
                                <input type="number" min={0} className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.totalAmount} onChange={(e) => setKarteForm((p) => ({ ...p, totalAmount: Number(e.target.value) }))} />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium">treatmentDescription</label>
                            <textarea className="mt-1 w-full border rounded-md px-3 py-2 text-sm min-h-[90px]" value={karteForm.treatmentDescription} onChange={(e) => setKarteForm((p) => ({ ...p, treatmentDescription: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium">tags (CSV)</label>
                                <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.tags} onChange={(e) => setKarteForm((p) => ({ ...p, tags: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-sm font-medium">status</label>
                                <select className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={karteForm.status} onChange={(e) => setKarteForm((p) => ({ ...p, status: e.target.value as "draft" | "completed" }))}>
                                    <option value="draft">draft</option>
                                    <option value="completed">completed</option>
                                </select>
                            </div>
                        </div>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsKarteDialogOpen(false)} disabled={saving}>キャンセル</Button>
                        <Button onClick={saveKarte} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>{selectedTemplate ? "テンプレート編集" : "テンプレート作成"}</DialogHeader>
                    <DialogBody className="space-y-3">
                        {templateFormError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {templateFormError}
                            </div>
                        )}
                        <div>
                            <label className="text-sm font-medium">name *</label>
                            <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={templateForm.name} onChange={(e) => {
                                setTemplateForm((p) => ({ ...p, name: e.target.value }));
                                if (templateFormError) setTemplateFormError(null);
                            }} />
                        </div>
                        <div>
                            <label className="text-sm font-medium">description</label>
                            <textarea className="mt-1 w-full border rounded-md px-3 py-2 text-sm min-h-[80px]" value={templateForm.description} onChange={(e) => setTemplateForm((p) => ({ ...p, description: e.target.value }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="inline-flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={templateForm.isDefault} onChange={(e) => setTemplateForm((p) => ({ ...p, isDefault: e.target.checked }))} />
                                isDefault
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={templateForm.isActive} onChange={(e) => setTemplateForm((p) => ({ ...p, isActive: e.target.checked }))} />
                                isActive
                            </label>
                        </div>
                        <div>
                            <label className="text-sm font-medium">displayOrder</label>
                            <input type="number" min={0} className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={templateForm.displayOrder} onChange={(e) => setTemplateForm((p) => ({ ...p, displayOrder: Number(e.target.value) }))} />
                        </div>
                        <div>
                            <label className="text-sm font-medium">applicableMenuCategories (CSV)</label>
                            <input className="mt-1 w-full border rounded-md px-3 py-2 text-sm" value={templateForm.applicableMenuCategories} onChange={(e) => setTemplateForm((p) => ({ ...p, applicableMenuCategories: e.target.value }))} />
                        </div>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)} disabled={saving}>キャンセル</Button>
                        <Button onClick={saveTemplate} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={isDeleteDialogOpen}
                onClose={() => setIsDeleteDialogOpen(false)}
                onConfirm={remove}
                title={deleteTarget === "karte" ? "カルテを削除" : "テンプレートを削除"}
                description={
                    deleteTarget === "karte"
                        ? `「${selectedKarte?.customerName || selectedKarte?.id || "このカルテ"}」を削除しますか？`
                        : `「${selectedTemplate?.name || "このテンプレート"}」を削除しますか？`
                }
                confirmText="削除"
                variant="danger"
                loading={saving}
            />
        </div>
    );
}
