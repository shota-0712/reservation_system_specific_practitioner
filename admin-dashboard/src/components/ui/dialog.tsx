"use client";

import { Fragment, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
    open: boolean;
    onClose?: () => void;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
}

export function Dialog({ open, onClose, onOpenChange, children }: DialogProps) {
    if (!open) return null;
    const handleClose = () => {
        onOpenChange?.(false);
        onClose?.();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 transition-opacity"
                onClick={handleClose}
            />
            {/* Content */}
            <div className="relative z-10 w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
                {children}
            </div>
        </div>
    );
}

interface DialogContentProps {
    children: ReactNode;
    className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
    return (
        <div className={cn("bg-white rounded-xl shadow-xl overflow-hidden", className)}>
            {children}
        </div>
    );
}

interface DialogHeaderProps {
    children: ReactNode;
    onClose?: () => void;
}

export function DialogHeader({ children, onClose }: DialogHeaderProps) {
    return (
        <div className="flex items-center justify-between p-4 border-b">
            <div className="font-semibold text-lg">{children}</div>
            {onClose && (
                <button
                    onClick={onClose}
                    className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                >
                    <X className="h-5 w-5 text-gray-500" />
                </button>
            )}
        </div>
    );
}

interface DialogBodyProps {
    children: ReactNode;
    className?: string;
}

export function DialogBody({ children, className }: DialogBodyProps) {
    return <div className={cn("p-4", className)}>{children}</div>;
}

interface DialogFooterProps {
    children: ReactNode;
    className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
    return (
        <div className={cn("flex justify-end gap-2 p-4 border-t bg-gray-50", className)}>
            {children}
        </div>
    );
}

// Confirmation Dialog
interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "danger" | "warning" | "default";
    loading?: boolean;
}

export function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "確認",
    cancelText = "キャンセル",
    variant = "default",
    loading = false,
}: ConfirmDialogProps) {
    const variantStyles = {
        danger: "bg-red-500 hover:bg-red-600 text-white",
        warning: "bg-yellow-500 hover:bg-yellow-600 text-white",
        default: "bg-primary hover:bg-primary/90 text-white",
    };

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogContent>
                <DialogHeader onClose={onClose}>{title}</DialogHeader>
                <DialogBody>
                    <p className="text-gray-600">{description}</p>
                </DialogBody>
                <DialogFooter>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={loading}
                        className={cn(
                            "px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2",
                            variantStyles[variant]
                        )}
                    >
                        {loading && (
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        )}
                        {confirmText}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
