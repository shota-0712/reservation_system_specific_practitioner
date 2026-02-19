"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    LayoutDashboard,
    Calendar,
    Users,
    BarChart3,
    Settings,
    Menu,
    Scissors,
    ClipboardList,
    ChevronDown,
    Building2,
    Package,
    FileText,
    Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    adminContextApi,
    getActiveStoreId,
    getTenantKeyOrNull,
    setActiveStoreId,
    STORE_CHANGED_EVENT,
    TENANT_CHANGED_EVENT,
    storesApi,
    withTenantQuery,
} from "@/lib/api";

const navigation = [
    { name: "ダッシュボード", href: "/", icon: LayoutDashboard },
    { name: "予約カレンダー", href: "/calendar", icon: Calendar },
    { name: "予約一覧", href: "/reservations", icon: ClipboardList },
    { name: "顧客管理", href: "/customers", icon: Users },
    { name: "レポート", href: "/reports", icon: BarChart3 },
    { name: "スタッフ", href: "/staff", icon: Users },
    { name: "メニュー", href: "/menus", icon: Menu },
    { name: "オプション", href: "/options", icon: Package },
    { name: "店舗", href: "/stores", icon: Building2 },
    { name: "カルテ", href: "/kartes", icon: FileText },
    { name: "連携", href: "/integrations", icon: Link2 },
    { name: "設定", href: "/settings", icon: Settings },
];

type StoreItem = {
    id: string;
    name: string;
    storeCode?: string;
    status?: string;
};

interface SidebarProps {
    className?: string;
    onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [showStoreSelector, setShowStoreSelector] = useState(false);
    const [stores, setStores] = useState<StoreItem[]>([]);
    const [currentStoreId, setCurrentStoreId] = useState<string | null>(null);
    const [tenantKey, setTenantKeyState] = useState<string>("");

    const loadStoresForTenant = useCallback(async (targetTenantKey?: string) => {
        const context = await adminContextApi.sync(targetTenantKey);
        const resolvedTenantKey = context?.tenantKey || targetTenantKey || getTenantKeyOrNull() || '';
        setTenantKeyState(resolvedTenantKey);

        const storeResponse = await storesApi.list();

        if (!storeResponse.success) {
            setStores([]);
            setCurrentStoreId(null);
            setActiveStoreId(null);
            return;
        }

        const storeList = (storeResponse.data as StoreItem[] | undefined) ?? [];
        const activeStoreList = storeList.filter((store) => store.status !== "inactive");
        const baseStores = activeStoreList.length > 0 ? activeStoreList : storeList;
        const allowedStoreIds = (context?.storeIds ?? []).filter(Boolean);
        const visibleStores = allowedStoreIds.length > 0
            ? baseStores.filter((store) => allowedStoreIds.includes(store.id))
            : baseStores;

        setStores(visibleStores);

        if (visibleStores.length === 0) {
            setCurrentStoreId(null);
            setActiveStoreId(null);
            return;
        }

        const storedStoreId = getActiveStoreId();
        const initialStoreId = visibleStores.some((store) => store.id === storedStoreId)
            ? storedStoreId
            : visibleStores[0].id;

        if (initialStoreId) {
            setCurrentStoreId(initialStoreId);
            setActiveStoreId(initialStoreId);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        loadStoresForTenant(getTenantKeyOrNull() ?? undefined).catch(() => {
            if (!mounted) return;
            setStores([]);
            setCurrentStoreId(null);
            setActiveStoreId(null);
        });

        return () => {
            mounted = false;
        };
    }, [loadStoresForTenant]);

    useEffect(() => {
        const handleStoreChanged = (event: Event) => {
            const customEvent = event as CustomEvent<{ storeId?: string | null }>;
            const nextStoreId = customEvent.detail?.storeId ?? null;
            setCurrentStoreId(nextStoreId);
        };
        const handleTenantChanged = () => {
            const nextTenantKey = getTenantKeyOrNull() ?? undefined;
            void loadStoresForTenant(nextTenantKey);
        };
        window.addEventListener(STORE_CHANGED_EVENT, handleStoreChanged);
        window.addEventListener(TENANT_CHANGED_EVENT, handleTenantChanged);
        return () => {
            window.removeEventListener(STORE_CHANGED_EVENT, handleStoreChanged);
            window.removeEventListener(TENANT_CHANGED_EVENT, handleTenantChanged);
        };
    }, [loadStoresForTenant]);

    const currentStore = stores.find((store) => store.id === currentStoreId) ?? stores[0] ?? null;
    const switchableStores = stores.filter((store) => store.id !== currentStoreId);

    const handleStoreChange = (store: StoreItem) => {
        if (currentStoreId === store.id) {
            setShowStoreSelector(false);
            return;
        }
        setCurrentStoreId(store.id);
        setActiveStoreId(store.id);
        setShowStoreSelector(false);
        router.refresh();
        onNavigate?.();
    };

    return (
        <div className={cn("flex h-full w-64 flex-col bg-gray-900 text-white", className)}>
            {/* Logo */}
            <div className="flex h-16 items-center gap-2 px-6 border-b border-gray-800">
                <Scissors className="h-8 w-8 text-primary" />
                <span className="text-xl font-bold">Salon Admin</span>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
                {navigation.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            href={withTenantQuery(item.href, tenantKey)}
                            onClick={onNavigate}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary text-white"
                                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                            )}
                        >
                            <item.icon className="h-5 w-5" />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            {/* Store Selector (Multi-tenant) */}
            <div className="border-t border-gray-800 p-3">
                <div className="relative">
                    <button
                        onClick={() => setShowStoreSelector(!showStoreSelector)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                            <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                            <div className="text-sm font-medium truncate">
                                {currentStore?.name ?? "店舗がありません"}
                            </div>
                            <div className="text-xs text-gray-400">
                                {currentStore?.storeCode ? `code: ${currentStore.storeCode}` : ""}
                            </div>
                        </div>
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 text-gray-400 transition-transform",
                                showStoreSelector && "rotate-180"
                            )}
                        />
                    </button>

                    {/* Store Dropdown */}
                    {showStoreSelector && (
                        <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
                            <div className="p-2 border-b border-gray-700">
                                <span className="text-xs text-gray-400 px-2">店舗を切り替え</span>
                            </div>
                            <div className="py-1">
                                {stores.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-gray-400">店舗データを取得できませんでした</div>
                                )}
                                {stores.length > 0 && switchableStores.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-gray-400">切り替え可能な店舗はありません</div>
                                )}
                                {switchableStores.map((store) => (
                                    <button
                                        key={store.id}
                                        onClick={() => handleStoreChange(store)}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-700 transition-colors"
                                        )}
                                    >
                                        <div className="flex-shrink-0 w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
                                            <Building2 className="h-3 w-3 text-primary" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <div className="text-sm truncate">{store.name}</div>
                                            <div className="text-xs text-gray-400">
                                                {store.storeCode ? `code: ${store.storeCode}` : ""}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="p-2 border-t border-gray-700">
                                <button
                                    onClick={() => {
                                        setShowStoreSelector(false);
                                        router.push(withTenantQuery("/stores", tenantKey));
                                        onNavigate?.();
                                    }}
                                    className="w-full text-center text-xs text-primary hover:underline py-1"
                                >
                                    + 新しい店舗を追加
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
