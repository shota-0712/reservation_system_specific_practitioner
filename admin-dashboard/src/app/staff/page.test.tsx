import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import StaffPage from "./page";
import { ToastProvider } from "@/components/ui/toast";

vi.mock("@/lib/api", () => ({
    assignmentsApi: {
        getPractitionerStores: vi.fn(),
    },
    bookingLinksApi: {
        list: vi.fn(),
        create: vi.fn(),
        revoke: vi.fn(),
    },
    getActiveStoreId: vi.fn(() => null),
    practitionersApi: {
        listAll: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
    settingsApi: {
        resolveLinePreview: vi.fn(),
    },
    STORE_CHANGED_EVENT: "reserve:store-changed",
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

import { bookingLinksApi, practitionersApi } from "@/lib/api";

function renderPage() {
    return render(
        <ToastProvider>
            <StaffPage />
        </ToastProvider>
    );
}

describe("StaffPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(practitionersApi.listAll).mockResolvedValue({
            success: true,
            data: [],
        });
        vi.mocked(practitionersApi.create).mockResolvedValue({
            success: true,
            data: {
                id: "staff-1",
            },
        });
        vi.mocked(bookingLinksApi.list).mockResolvedValue({
            success: true,
            data: [],
        });
    });

    it("saves customer-app related staff fields in the practitioner payload", async () => {
        renderPage();

        await waitFor(() => {
            expect(practitionersApi.listAll).toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole("button", { name: "新規スタッフ" }));

        fireEvent.change(screen.getByPlaceholderText("山田 太郎"), {
            target: { value: "山田 花子" },
        });
        fireEvent.change(screen.getByPlaceholderText("https://example.com/staff.jpg"), {
            target: { value: "https://example.com/staff.jpg" },
        });
        fireEvent.change(screen.getByPlaceholderText("トップスタイリスト"), {
            target: { value: "トップスタイリスト" },
        });
        fireEvent.change(screen.getByPlaceholderText("歴8年"), {
            target: { value: "歴8年" },
        });
        fireEvent.change(screen.getByPlaceholderText("カラー, メンズ, ヘッドスパ"), {
            target: { value: "カラー, ヘッドスパ" },
        });
        fireEvent.change(screen.getAllByPlaceholderText("@stylist_account")[0], {
            target: { value: "@hanako_salon" },
        });
        fireEvent.change(screen.getAllByPlaceholderText("@stylist_account")[1], {
            target: { value: "@hanako_x" },
        });
        fireEvent.change(screen.getByPlaceholderText("透明感カラーならお任せください"), {
            target: { value: "透明感カラーが得意です" },
        });
        fireEvent.change(screen.getByPlaceholderText("customer-app に表示する紹介文"), {
            target: { value: "自然体で過ごしやすいスタイルを提案します。" },
        });
        fireEvent.change(screen.getByRole("spinbutton"), {
            target: { value: "1100" },
        });

        fireEvent.click(screen.getByRole("button", { name: "作成" }));

        await waitFor(() => {
            expect(practitionersApi.create).toHaveBeenCalledWith({
                name: "山田 花子",
                nameKana: undefined,
                role: "stylist",
                phone: undefined,
                email: undefined,
                imageUrl: "https://example.com/staff.jpg",
                color: "#3b82f6",
                title: "トップスタイリスト",
                description: "自然体で過ごしやすいスタイルを提案します。",
                experience: "歴8年",
                prTitle: "透明感カラーが得意です",
                specialties: ["カラー", "ヘッドスパ"],
                snsInstagram: "@hanako_salon",
                snsTwitter: "@hanako_x",
                nominationFee: 1100,
                isActive: true,
                schedule: {
                    workDays: [1, 2, 3, 4, 5],
                    workHours: { start: "10:00", end: "19:00" },
                },
                lineConfig: undefined,
            });
        });
    });
});
