import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MainLayout } from "./main-layout";

const replace = vi.fn();
const push = vi.fn();
const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
    usePathname: () => mockUsePathname(),
    useRouter: () => ({
        push,
        replace,
    }),
}));

vi.mock("@/components/layout/sidebar", () => ({
    Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock("@/components/layout/header", () => ({
    Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/ui/toast", () => ({
    ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/auth-context", () => ({
    useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
    adminContextApi: {
        sync: vi.fn(),
    },
    onboardingApi: {
        getStatus: vi.fn(),
    },
    platformAdminApi: {
        syncClaims: vi.fn(),
    },
}));

import { useAuth } from "@/lib/auth-context";
import { adminContextApi, onboardingApi, platformAdminApi } from "@/lib/api";

describe("MainLayout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUsePathname.mockReturnValue("/");

        const user = {
            getIdTokenResult: vi.fn().mockResolvedValue({
                claims: { tenantId: "tenant-1" },
            }),
            getIdToken: vi.fn().mockResolvedValue("token"),
        };

        vi.mocked(useAuth).mockReturnValue({
            user: user as never,
            loading: false,
            login: vi.fn(),
            register: vi.fn(),
            logout: vi.fn(),
            getAuthToken: vi.fn(),
        });
        vi.mocked(adminContextApi.sync).mockResolvedValue(null);
        vi.mocked(platformAdminApi.syncClaims).mockResolvedValue({
            success: true,
            data: { tenantId: "tenant-1" },
        });
    });

    it("redirects incomplete onboarding users before rendering protected content", async () => {
        vi.mocked(onboardingApi.getStatus).mockResolvedValue({
            success: true,
            data: {
                onboardingStatus: "pending",
                completed: false,
            },
        });

        render(
            <MainLayout>
                <div>dashboard child</div>
            </MainLayout>
        );

        expect(screen.queryByText("dashboard child")).not.toBeInTheDocument();

        await waitFor(() => {
            expect(replace).toHaveBeenCalledWith("/onboarding");
        });
        expect(screen.getByText("画面を移動中...")).toBeInTheDocument();
    });

    it("redirects completed onboarding users away from the onboarding page without flashing it", async () => {
        mockUsePathname.mockReturnValue("/onboarding");
        vi.mocked(onboardingApi.getStatus).mockResolvedValue({
            success: true,
            data: {
                onboardingStatus: "completed",
                completed: true,
            },
        });

        render(
            <MainLayout>
                <div>onboarding child</div>
            </MainLayout>
        );

        expect(screen.queryByText("onboarding child")).not.toBeInTheDocument();

        await waitFor(() => {
            expect(replace).toHaveBeenCalledWith("/");
        });
        expect(screen.getByText("画面を移動中...")).toBeInTheDocument();
    });
});
