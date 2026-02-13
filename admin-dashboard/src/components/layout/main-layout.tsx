"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";
import { adminContextApi, onboardingApi } from "@/lib/api";

interface MainLayoutProps {
    children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [onboardingStatus, setOnboardingStatus] = useState<'pending' | 'in_progress' | 'completed' | null>(null);
    const [onboardingLoading, setOnboardingLoading] = useState(false);
    const pathname = usePathname();
    const router = useRouter();
    const { user, loading } = useAuth();

    // Close sidebar on route change (mobile)
    useEffect(() => {
        setIsSidebarOpen(false);
    }, [pathname]);

    // Close sidebar when clicking outside (mobile)
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                setIsSidebarOpen(false);
            }
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const isPublicAuthRoute = pathname === "/login" || pathname === "/signup" || pathname === "/register";
    const isOnboardingRoute = pathname === "/onboarding";

    // Redirect to login if not authenticated
    useEffect(() => {
        // Skip for auth pages
        if (isPublicAuthRoute) return;

        // Skip during initial loading
        if (loading) return;

        // Redirect to login if no user
        if (!user) {
            router.push("/login");
        }
    }, [user, loading, isPublicAuthRoute, router]);

    useEffect(() => {
        if (isPublicAuthRoute) return;
        if (loading || !user) return;

        let mounted = true;
        setOnboardingLoading(true);
        (async () => {
            try {
                // Resolve admin context first to avoid stale tenant/store localStorage state.
                await adminContextApi.sync();
            } catch {
                // continue with existing tenant context
            }

            const response = await onboardingApi.getStatus();
            if (!mounted) return;
            if (!response.success) {
                setOnboardingStatus('pending');
                return;
            }
            setOnboardingStatus(response.data?.onboardingStatus ?? 'pending');
        })().catch(() => {
            if (mounted) {
                setOnboardingStatus('pending');
            }
        }).finally(() => {
            if (mounted) {
                setOnboardingLoading(false);
            }
        });

        return () => {
            mounted = false;
        };
    }, [isPublicAuthRoute, loading, user, pathname]);

    useEffect(() => {
        if (isPublicAuthRoute) return;
        if (loading || onboardingLoading || !user || !onboardingStatus) return;

        if (onboardingStatus !== 'completed' && !isOnboardingRoute) {
            router.push('/onboarding');
            return;
        }

        if (onboardingStatus === 'completed' && isOnboardingRoute) {
            router.push('/');
        }
    }, [isOnboardingRoute, isPublicAuthRoute, loading, onboardingLoading, onboardingStatus, router, user]);

    // Don't show layout on auth pages
    if (isPublicAuthRoute) {
        return <>{children}</>;
    }

    // Show loading spinner while checking authentication
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">読み込み中...</p>
                </div>
            </div>
        );
    }

    // Don't render protected content if not authenticated
    if (!user) {
        return null;
    }

    if (onboardingLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">初期設定状態を確認中...</p>
                </div>
            </div>
        );
    }

    if (isOnboardingRoute) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen">
            {/* Desktop Sidebar */}
            <div className="hidden md:block">
                <Sidebar />
            </div>

            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Mobile Sidebar */}
            <div
                className={cn(
                    "fixed inset-y-0 left-0 z-50 md:hidden transform transition-transform duration-300 ease-in-out",
                    isSidebarOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
            </div>

            {/* Main Content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <Header
                    onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    isSidebarOpen={isSidebarOpen}
                />
                <main className="flex-1 overflow-auto bg-gray-50 p-4 md:p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}
