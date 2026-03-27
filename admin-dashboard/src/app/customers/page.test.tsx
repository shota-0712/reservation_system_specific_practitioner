import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CustomersPage from "./page";

vi.mock("@/lib/api", () => ({
    customersApi: {
        list: vi.fn(),
    },
}));

vi.mock("@/lib/logger", () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

import { customersApi } from "@/lib/api";

describe("CustomersPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("aggregates revenue and visit counts correctly when API returns numeric strings", async () => {
        vi.mocked(customersApi.list).mockResolvedValue({
            success: true,
            data: [
                {
                    id: "customer-1",
                    name: "阿部里奈",
                    phone: "0907002329",
                    email: "abe@example.com",
                    totalVisits: "2",
                    totalSpend: "8850.00",
                    createdAt: "2026-03-01T00:00:00.000Z",
                },
                {
                    id: "customer-2",
                    name: "井上翔",
                    phone: "0907001918",
                    email: "inoue@example.com",
                    totalVisits: "4",
                    totalSpend: "30800.00",
                    createdAt: "2026-03-02T00:00:00.000Z",
                },
            ],
            meta: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 1,
                hasNext: false,
                hasPrev: false,
            },
        });

        render(<CustomersPage />);

        await waitFor(() => {
            expect(customersApi.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
        });

        expect(screen.getByText("2名")).toBeInTheDocument();
        expect(screen.getByText("¥39,650")).toBeInTheDocument();
        expect(screen.getByText("3.0回")).toBeInTheDocument();
    });
});
