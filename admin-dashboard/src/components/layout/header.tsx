"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Bell,
    Search,
    User,
    LogOut,
    Settings,
    ChevronDown,
    Menu,
    X,
    Calendar,
    UserPlus,
    AlertCircle,
    CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dashboardApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface Notification {
    id: string;
    type: "reservation" | "customer" | "alert" | "success";
    title: string;
    message: string;
    time: string;
    read: boolean;
}

interface HeaderProps {
    onMenuClick?: () => void;
    isSidebarOpen?: boolean;
}

const notificationIcons = {
    reservation: Calendar,
    customer: UserPlus,
    alert: AlertCircle,
    success: CheckCircle,
};

const notificationColors = {
    reservation: "text-blue-500 bg-blue-50",
    customer: "text-purple-500 bg-purple-50",
    alert: "text-red-500 bg-red-50",
    success: "text-green-500 bg-green-50",
};

const formatRelativeTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));

    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return `${diffMin}分前`;

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;

    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}日前`;
};

const formatActionLabel = (action: string): string => {
    if (action === "CREATE") return "作成";
    if (action === "UPDATE") return "更新";
    if (action === "DELETE") return "削除";
    return "変更";
};

const toNotificationType = (entityType: string, action: string): Notification["type"] => {
    const lowerEntity = entityType.toLowerCase();
    if (lowerEntity.includes("reservation")) return "reservation";
    if (lowerEntity.includes("customer")) return "customer";
    if (action === "DELETE") return "alert";
    return "success";
};

const toNotificationTitle = (entityType: string, action: string): string => {
    const entityLabel =
        entityType === "reservation"
            ? "予約"
            : entityType === "customer"
              ? "顧客"
              : entityType || "データ";

    return `${entityLabel}${formatActionLabel(action)}`;
};

export function Header({ onMenuClick, isSidebarOpen }: HeaderProps) {
    const router = useRouter();
    const { user, logout } = useAuth();

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loadingNotifications, setLoadingNotifications] = useState(false);

    const userMenuRef = useRef<HTMLDivElement>(null);
    const notificationRef = useRef<HTMLDivElement>(null);

    const unreadCount = notifications.filter((n) => !n.read).length;
    const displayName = user?.displayName || user?.email?.split("@")[0] || "管理者";
    const displayEmail = user?.email || "-";

    useEffect(() => {
        const fetchNotifications = async () => {
            setLoadingNotifications(true);
            try {
                const response = await dashboardApi.getActivity(20);
                const rows = response.success && Array.isArray(response.data) ? response.data : [];
                const mapped: Notification[] = rows.map((row, index) => {
                    const item = row as Record<string, unknown>;
                    const entityType = typeof item.entityType === "string" ? item.entityType : "";
                    const action = typeof item.action === "string" ? item.action : "UPDATE";
                    const actorName = typeof item.actorName === "string" ? item.actorName : "システム";
                    const createdAt =
                        typeof item.createdAt === "string"
                            ? item.createdAt
                            : new Date().toISOString();
                    const entityId = typeof item.entityId === "string" ? item.entityId : `row-${index}`;

                    return {
                        id: `${entityId}-${action}-${createdAt}`,
                        type: toNotificationType(entityType, action),
                        title: toNotificationTitle(entityType, action),
                        message: `${actorName}が${entityType || "データ"}を${formatActionLabel(action)}しました`,
                        time: formatRelativeTime(createdAt),
                        read: false,
                    };
                });

                setNotifications((current) => {
                    const currentReadMap = new Map(current.map((notification) => [notification.id, notification.read]));
                    return mapped.map((notification) => ({
                        ...notification,
                        read: currentReadMap.get(notification.id) ?? false,
                    }));
                });
            } catch (error) {
                console.error("Failed to load notifications:", error);
                setNotifications([]);
            } finally {
                setLoadingNotifications(false);
            }
        };

        fetchNotifications();
        const timer = window.setInterval(fetchNotifications, 60 * 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
                setShowUserMenu(false);
            }
            if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
                setShowNotifications(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = async () => {
        try {
            await logout();
        } catch (error) {
            console.error("Failed to logout:", error);
        }
        router.push("/login");
    };

    const markAllAsRead = () => {
        setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
    };

    const markAsRead = (id: string) => {
        setNotifications((current) =>
            current.map((notification) =>
                notification.id === id ? { ...notification, read: true } : notification
            )
        );
    };

    return (
        <header className="flex h-16 items-center justify-between border-b bg-white px-4 md:px-6">
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={onMenuClick}
                >
                    {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </Button>

                <div className="relative hidden sm:block">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="顧客・予約を検索..."
                        className="h-10 w-48 md:w-64 rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
                <div ref={notificationRef} className="relative">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="relative"
                        onClick={() => setShowNotifications(!showNotifications)}
                    >
                        <Bell className="h-5 w-5" />
                        {unreadCount > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                                {unreadCount}
                            </span>
                        )}
                    </Button>

                    {showNotifications && (
                        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border bg-white shadow-lg z-50">
                            <div className="flex items-center justify-between p-4 border-b">
                                <h3 className="font-semibold">通知</h3>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        すべて既読にする
                                    </button>
                                )}
                            </div>
                            <div className="max-h-80 overflow-y-auto">
                                {loadingNotifications && notifications.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">
                                        通知を読み込み中...
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">
                                        通知はありません
                                    </div>
                                ) : (
                                    notifications.map((notification) => {
                                        const Icon = notificationIcons[notification.type];
                                        return (
                                            <div
                                                key={notification.id}
                                                className={cn(
                                                    "flex gap-3 p-4 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors",
                                                    !notification.read && "bg-blue-50/50"
                                                )}
                                                onClick={() => markAsRead(notification.id)}
                                            >
                                                <div
                                                    className={cn(
                                                        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                                                        notificationColors[notification.type]
                                                    )}
                                                >
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-sm">
                                                            {notification.title}
                                                        </span>
                                                        {!notification.read && (
                                                            <span className="w-2 h-2 rounded-full bg-primary" />
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-gray-600 truncate">
                                                        {notification.message}
                                                    </p>
                                                    <span className="text-xs text-gray-400">
                                                        {notification.time}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div ref={userMenuRef} className="relative">
                    <button
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        className="flex items-center gap-2 md:gap-3 border-l pl-2 md:pl-4 hover:opacity-80 transition-opacity"
                    >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-medium text-white">
                            <User className="h-4 w-4" />
                        </div>
                        <div className="text-sm text-left hidden md:block">
                            <div className="font-medium">{displayName}</div>
                            <div className="text-xs text-gray-500">管理者</div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-gray-400 hidden md:block" />
                    </button>

                    {showUserMenu && (
                        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border bg-white shadow-lg z-50">
                            <div className="p-4 border-b">
                                <div className="font-medium">{displayName}</div>
                                <div className="text-sm text-gray-500">{displayEmail}</div>
                                <div className="mt-2 px-2 py-1 bg-primary/10 text-primary text-xs rounded-full inline-block">
                                    管理者
                                </div>
                            </div>

                            <div className="py-2">
                                <button
                                    onClick={() => {
                                        setShowUserMenu(false);
                                        router.push("/settings");
                                    }}
                                    className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    <Settings className="h-4 w-4" />
                                    設定
                                </button>
                            </div>

                            <div className="border-t py-2">
                                <button
                                    onClick={handleLogout}
                                    className="flex items-center gap-3 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                >
                                    <LogOut className="h-4 w-4" />
                                    ログアウト
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
