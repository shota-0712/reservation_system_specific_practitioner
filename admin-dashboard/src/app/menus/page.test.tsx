import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MenusPage from "./page";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("@/lib/api", () => ({
    menusApi: {
        listAll: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

import { menusApi } from "@/lib/api";

function renderPage() {
    return render(
        <ToastProvider>
            <MenusPage />
        </ToastProvider>
    );
}

describe("MenusPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(menusApi.listAll).mockResolvedValue({
            success: true,
            data: [],
        });
        vi.mocked(menusApi.create).mockResolvedValue({
            success: true,
            data: {
                id: "menu-1",
            },
        });
    });

    it("saves menu imageUrl with the rest of the menu payload", async () => {
        renderPage();

        await waitFor(() => {
            expect(menusApi.listAll).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole("button", { name: "新規メニュー" }));
        fireEvent.change(screen.getByPlaceholderText("カット"), {
            target: { value: "カット" },
        });
        fireEvent.change(screen.getByPlaceholderText("カット / カラー / パーマ / etc."), {
            target: { value: "カット" },
        });
        fireEvent.change(screen.getByPlaceholderText("https://example.com/menu.jpg"), {
            target: { value: "https://example.com/menu.jpg" },
        });

        fireEvent.click(screen.getByRole("button", { name: "作成" }));

        await waitFor(() => {
            expect(menusApi.create).toHaveBeenCalledWith({
                name: "カット",
                description: undefined,
                category: "カット",
                imageUrl: "https://example.com/menu.jpg",
                duration: 60,
                price: 5000,
                isActive: true,
            });
        });
    });
});
