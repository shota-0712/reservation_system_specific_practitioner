"use client";

import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, Clock, CircleDollarSign, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { menusApi } from "@/lib/api";

interface Menu {
    id: string;
    name: string;
    description?: string;
    category: string;
    duration: number;
    price: number;
    imageUrl?: string;
    isActive: boolean;
}

export default function MenusPage() {
    const { pushToast } = useToast();
    const [menus, setMenus] = useState<Menu[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState("すべて");
    const [showInactive, setShowInactive] = useState(false);

    // Modal states
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: "",
        description: "",
        category: "",
        duration: 60,
        price: 5000,
        isActive: true,
    });

    // データ取得
    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await menusApi.listAll();
            if (res.success && res.data) {
                setMenus(res.data as Menu[]);
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
        fetchData();
    }, []);

    // Open create modal
    const handleCreate = () => {
        setSelectedMenu(null);
        setFormError(null);
        setFormData({
            name: "",
            description: "",
            category: "",
            duration: 60,
            price: 5000,
            isActive: true,
        });
        setIsEditModalOpen(true);
    };

    // Open edit modal
    const handleEdit = (menu: Menu) => {
        setSelectedMenu(menu);
        setFormError(null);
        setFormData({
            name: menu.name,
            description: menu.description || "",
            category: menu.category,
            duration: menu.duration,
            price: menu.price,
            isActive: menu.isActive,
        });
        setIsEditModalOpen(true);
    };

    // Open delete dialog
    const handleDeleteClick = (menu: Menu) => {
        setSelectedMenu(menu);
        setIsDeleteDialogOpen(true);
    };

    // Save (create or update)
    const handleSave = async () => {
        setFormError(null);
        if (!formData.name.trim()) {
            setFormError("メニュー名を入力してください");
            pushToast({ variant: "warning", title: "入力内容を確認してください", description: "メニュー名は必須です。" });
            return;
        }
        if (!formData.category.trim()) {
            setFormError("カテゴリを入力してください");
            pushToast({ variant: "warning", title: "入力内容を確認してください", description: "カテゴリは必須です。" });
            return;
        }

        setIsSaving(true);
        try {
            const data = {
                name: formData.name,
                description: formData.description || null,
                category: formData.category,
                duration: formData.duration,
                price: formData.price,
                isActive: formData.isActive,
            };

            if (selectedMenu) {
                const res = await menusApi.update(selectedMenu.id, data);
                if (!res.success) throw new Error(res.error?.message || "更新に失敗しました");
            } else {
                const res = await menusApi.create(data);
                if (!res.success) throw new Error(res.error?.message || "作成に失敗しました");
            }

            setIsEditModalOpen(false);
            pushToast({
                variant: "success",
                title: selectedMenu ? "メニューを更新しました" : "メニューを作成しました",
            });
            fetchData();
        } catch (err: any) {
            pushToast({
                variant: "error",
                title: "保存に失敗しました",
                description: err.message || "メニュー保存に失敗しました",
            });
        } finally {
            setIsSaving(false);
        }
    };

    // Delete
    const handleDelete = async () => {
        if (!selectedMenu) return;

        setIsSaving(true);
        try {
            const res = await menusApi.delete(selectedMenu.id);
            if (!res.success) throw new Error(res.error?.message || "削除に失敗しました");

            setIsDeleteDialogOpen(false);
            setSelectedMenu(null);
            pushToast({
                variant: "success",
                title: "メニューを削除しました",
            });
            fetchData();
        } catch (err: any) {
            pushToast({
                variant: "error",
                title: "削除に失敗しました",
                description: err.message || "メニュー削除に失敗しました",
            });
        } finally {
            setIsSaving(false);
        }
    };

    // カテゴリ一覧を取得
    const categories = ["すべて", ...Array.from(new Set(menus.map((m) => m.category)))];

    // フィルタ適用
    const filteredMenus = menus.filter((menu) => {
        if (!showInactive && !menu.isActive) return false;
        if (selectedCategory === "すべて") return true;
        return menu.category === selectedCategory;
    });

    // 統計
    const activeMenuCount = menus.filter(m => m.isActive).length;
    const categoryCount = new Set(menus.filter(m => m.isActive).map(m => m.category)).size;
    const avgPrice = menus.length > 0 ? menus.reduce((sum, m) => sum + m.price, 0) / menus.length : 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">メニュー管理</h1>
                    <p className="text-muted-foreground">
                        施術メニューとオプションを管理します
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchData}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button onClick={handleCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        新規メニュー
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
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">公開メニュー数</div>
                        <div className="text-2xl font-bold">{activeMenuCount}件</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">カテゴリ数</div>
                        <div className="text-2xl font-bold">{categoryCount}種類</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-sm text-muted-foreground">平均単価</div>
                        <div className="text-2xl font-bold">¥{Math.round(avgPrice).toLocaleString()}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2 flex-wrap">
                {categories.map((category) => (
                    <Button
                        key={category}
                        variant={selectedCategory === category ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedCategory(category)}
                    >
                        {category}
                    </Button>
                ))}
                <label className="ml-4 flex items-center gap-2 text-sm cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                    />
                    非公開メニューを表示
                </label>
            </div>

            {/* Menu List */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    読み込み中...
                </div>
            ) : filteredMenus.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    {menus.length === 0 ? 'メニューが登録されていません' : '該当するメニューがありません'}
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredMenus.map((menu) => (
                        <Card
                            key={menu.id}
                            className={cn(
                                "relative",
                                !menu.isActive && "opacity-60 bg-gray-50"
                            )}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-semibold">{menu.name}</h3>
                                            {!menu.isActive && (
                                                <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                                                    非公開
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {menu.category}
                                        </span>
                                        {menu.description && (
                                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                                                {menu.description}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(menu)}>
                                            <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleDeleteClick(menu)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-4 flex items-center gap-4 text-sm">
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-4 w-4 text-muted-foreground" />
                                        <span>{menu.duration}分</span>
                                    </div>
                                    <div className="flex items-center gap-1 font-semibold text-primary">
                                        <CircleDollarSign className="h-4 w-4" />
                                        <span>¥{menu.price.toLocaleString()}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Edit/Create Modal */}
            <Dialog open={isEditModalOpen} onClose={() => setIsEditModalOpen(false)}>
                <DialogContent className="max-w-md">
                    <DialogHeader onClose={() => setIsEditModalOpen(false)}>
                        {selectedMenu ? "メニュー編集" : "新規メニュー"}
                    </DialogHeader>
                    <DialogBody className="space-y-4">
                        {formError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {formError}
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium mb-1">メニュー名 *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => {
                                    setFormData({ ...formData, name: e.target.value });
                                    if (formError) setFormError(null);
                                }}
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                placeholder="カット"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">カテゴリ *</label>
                            <input
                                type="text"
                                value={formData.category}
                                onChange={(e) => {
                                    setFormData({ ...formData, category: e.target.value });
                                    if (formError) setFormError(null);
                                }}
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                placeholder="カット / カラー / パーマ / etc."
                                list="category-suggestions"
                            />
                            <datalist id="category-suggestions">
                                {Array.from(new Set(menus.map(m => m.category))).map(cat => (
                                    <option key={cat} value={cat} />
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">説明</label>
                            <textarea
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                className="w-full h-24 px-3 py-2 rounded-lg border border-gray-200 focus:border-primary focus:outline-none resize-none"
                                placeholder="メニューの説明文"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">施術時間（分）</label>
                                <input
                                    type="number"
                                    value={formData.duration}
                                    onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) || 0 })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                    min={0}
                                    step={15}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">価格（円）</label>
                                <input
                                    type="number"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
                                    className="w-full h-10 px-3 rounded-lg border border-gray-200 focus:border-primary focus:outline-none"
                                    min={0}
                                    step={100}
                                />
                            </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                className="h-4 w-4 rounded border-gray-300"
                            />
                            <span className="text-sm">公開</span>
                        </label>
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isSaving}>
                            キャンセル
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {selectedMenu ? "更新" : "作成"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <ConfirmDialog
                open={isDeleteDialogOpen}
                onClose={() => setIsDeleteDialogOpen(false)}
                onConfirm={handleDelete}
                title="メニューを削除"
                description={`「${selectedMenu?.name}」を削除してもよろしいですか？この操作は取り消せません。`}
                confirmText="削除"
                cancelText="キャンセル"
                variant="danger"
                loading={isSaving}
            />
        </div>
    );
}
