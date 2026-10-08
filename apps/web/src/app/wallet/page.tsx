"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "../../lib/api";
import { useAuthStore } from "../../stores/auth";

interface LedgerEntry {
  id: string;
  amountMinor: number;
  type: string;
  createdAt: string;
}

interface WalletResponse {
  currency: "KES";
  balanceMinor: number;
  entries: LedgerEntry[];
}

const MOCK_PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_MODE === "mock";

function formatKes(amountMinor: number) {
  return `KES ${(amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const ENTRY_LABELS: Record<string, string> = {
  DEPOSIT: "Deposit",
  STAKE_LOCK: "Match stake",
  STAKE_REFUND: "Stake refund",
  MATCH_PAYOUT: "Match payout",
  PLATFORM_FEE: "Platform fee",
};

export default function WalletPage() {
  const router = useRouter();
  const { user, isLoading, fetchMe } = useAuthStore();
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [amountKes, setAmountKes] = useState(50);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadWallet = useCallback(async () => {
    try {
      const { data } = await api.get<WalletResponse>("/api/v1/wallet");
      setWallet(data);
      setError("");
    } catch {
      setError("Could not load your wallet. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
    if (user) void loadWallet();
  }, [isLoading, user, router, loadWallet]);

  async function addMockFunds(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!Number.isInteger(amountKes) || amountKes < 1 || amountKes > 1000) {
      setError("Enter an amount from KES 1 to KES 1,000.");
      return;
    }

    setFunding(true);
    setError("");
    setMessage("");
    try {
      const { data: deposit } = await api.post<{ depositId: string }>(
        "/api/v1/wallet/sandbox-deposits",
        { amountKes },
        { headers: { "Idempotency-Key": crypto.randomUUID() } }
      );
      await api.post(`/api/v1/wallet/sandbox-deposits/${deposit.depositId}/confirm`);
      await loadWallet();
      setMessage(`${formatKes(amountKes * 100)} mock funds added to your wallet.`);
    } catch (requestError: unknown) {
      const responseError = (requestError as { response?: { data?: { error?: string } } })
        .response?.data?.error;
      setError(responseError || "Mock deposit failed. Please retry.");
    } finally {
      setFunding(false);
    }
  }

  if (isLoading || !user || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-gray-400">Loading wallet...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 pt-8 sm:pt-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-400">Account</p>
          <h1 className="text-2xl font-bold">Wallet</h1>
        </div>
        <Link href="/play" className="text-sm text-gray-400 hover:text-white">
          Back to Play
        </Link>
      </header>

      <section className="rounded-lg border border-gray-700 bg-gray-900 p-5" aria-label="Wallet balance">
        <p className="text-sm text-gray-400">Available balance</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatKes(wallet?.balanceMinor ?? 0)}
        </p>
      </section>

      {MOCK_PAYMENTS_ENABLED && (
        <section className="rounded-lg border border-amber-700/70 bg-gray-900 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Add mock funds</h2>
            <span className="text-xs font-medium uppercase text-amber-300">Local testing only</span>
          </div>
          <p className="mb-4 text-sm text-gray-400">
            Simulated KES only. No payment is sent and these funds have no cash value.
          </p>
          <form onSubmit={addMockFunds} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-gray-300">
              Amount (KES)
              <input
                aria-label="Mock deposit amount in KES"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={amountKes}
                onChange={(event) => setAmountKes(Number(event.target.value))}
                className="h-10 w-36 rounded border border-gray-600 bg-gray-800 px-3 text-white"
                disabled={funding}
              />
            </label>
            <button
              type="submit"
              disabled={funding}
              className="h-10 rounded bg-amber-600 px-4 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {funding ? "Adding..." : "Add mock funds"}
            </button>
          </form>
        </section>
      )}

      {(error || message) && (
        <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-red-300" : "text-green-300"}`}>
          {error || message}
        </p>
      )}

      <section aria-labelledby="ledger-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="ledger-heading" className="font-semibold">Recent activity</h2>
          <button
            type="button"
            onClick={() => void loadWallet()}
            className="text-sm text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>
        {wallet?.entries.length ? (
          <ul className="divide-y divide-gray-800">
            {wallet.entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ENTRY_LABELS[entry.type] || entry.type}</p>
                  <time className="text-xs text-gray-500" dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </time>
                </div>
                <span className={`shrink-0 font-medium tabular-nums ${entry.amountMinor > 0 ? "text-green-300" : "text-gray-200"}`}>
                  {entry.amountMinor > 0 ? "+" : "−"}{formatKes(Math.abs(entry.amountMinor))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-sm text-gray-500">No wallet activity yet.</p>
        )}
      </section>
    </main>
  );
}