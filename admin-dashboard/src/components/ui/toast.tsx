"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "warning" | "error";

export interface ToastOptions {
    title: string;
    description?: string;
    variant?: ToastVariant;
    durationMs?: number;
    dedupeKey?: string;
}

interface ToastItem extends ToastOptions {
    id: string;
    variant: ToastVariant;
    createdAt: number;
}

interface ToastContextValue {
    pushToast: (options: ToastOptions) => void;
}

const TOAST_DURATION_MS = 3200;
const DEDUPE_WINDOW_MS = 1200;
const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { border: string; icon: string }> = {
    success: {
        border: "border-green-200",
        icon: "text-green-600",
    },
    warning: {
        border: "border-amber-200",
        icon: "text-amber-600",
    },
    error: {
        border: "border-red-200",
        icon: "text-red-600",
    },
};

function resolveVariantIcon(variant: ToastVariant) {
    if (variant === "success") return CheckCircle2;
    if (variant === "warning") return AlertTriangle;
    return AlertCircle;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const dedupeMapRef = useRef<Map<string, number>>(new Map());

    const dismissToast = useCallback((id: string) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const pushToast = useCallback((options: ToastOptions) => {
        const now = Date.now();
        const variant = options.variant ?? "success";
        const dedupeKey = options.dedupeKey ?? `${variant}:${options.title}:${options.description ?? ""}`;
        const lastShownAt = dedupeMapRef.current.get(dedupeKey);
        if (lastShownAt && now - lastShownAt < DEDUPE_WINDOW_MS) {
            return;
        }
        dedupeMapRef.current.set(dedupeKey, now);

        const id = `${now}-${Math.random().toString(36).slice(2, 10)}`;
        const toast: ToastItem = {
            id,
            title: options.title,
            description: options.description,
            variant,
            durationMs: options.durationMs ?? TOAST_DURATION_MS,
            dedupeKey,
            createdAt: now,
        };

        setToasts((current) => [toast, ...current].slice(0, 4));

        window.setTimeout(() => {
            dismissToast(id);
        }, toast.durationMs);
    }, [dismissToast]);

    const value = useMemo<ToastContextValue>(() => ({
        pushToast,
    }), [pushToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-full max-w-sm flex-col gap-2">
                {toasts.map((toast) => {
                    const Icon = resolveVariantIcon(toast.variant);
                    const styles = variantStyles[toast.variant];
                    return (
                        <div
                            key={toast.id}
                            className={cn(
                                "pointer-events-auto rounded-lg border bg-white px-3 py-3 shadow-md",
                                styles.border
                            )}
                        >
                            <div className="flex items-start gap-2">
                                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
                                    {toast.description && (
                                        <p className="mt-0.5 text-xs text-gray-600">{toast.description}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                    onClick={() => dismissToast(toast.id)}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within ToastProvider");
    }
    return context;
}
