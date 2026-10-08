import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockApi, mockAuthState } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn() },
  mockAuthState: {
    user: { id: "user-1", username: "wallet-user", email: "wallet@example.test", rating: 1200 },
    isLoading: false,
    fetchMe: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../lib/api", () => ({ default: mockApi }));
vi.mock("../../stores/auth", () => ({ useAuthStore: () => mockAuthState }));

import WalletPage from "./page";

describe("WalletPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({
      data: {
        currency: "KES",
        balanceMinor: 9000,
        entries: [
          {
            id: "entry-1",
            amountMinor: 9000,
            type: "MATCH_PAYOUT",
            createdAt: "2026-10-08T00:00:00.000Z",
          },
        ],
      },
    });
  });

  it("shows the balance and recent ledger activity", async () => {
    render(<WalletPage />);

    expect(await screen.findByText("KES 90.00")).toBeInTheDocument();
    expect(screen.getByText("Match payout")).toBeInTheDocument();
    expect(screen.getByText("+KES 90.00")).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith("/api/v1/wallet");
  });

  it("links back to play", async () => {
    render(<WalletPage />);

    await waitFor(() => expect(screen.getByText("Wallet")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Back to Play" })).toHaveAttribute("href", "/play");
  });
});
