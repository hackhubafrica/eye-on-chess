import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { lockGameStake, settleGameEscrow } from "./wallet.js";

function createTransactionMock() {
  return {
    wallet: {
      upsert: vi.fn(async ({ where }: { where: { userId: string } }) => ({ id: `wallet-${where.userId}` })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ledgerEntry: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
    },
    gameEscrow: {
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      findUnique: vi.fn(),
      update: vi.fn(async ({ data }: { data: unknown }) => data),
    },
  } as unknown as Prisma.TransactionClient & {
    wallet: { updateMany: ReturnType<typeof vi.fn> };
    ledgerEntry: { create: ReturnType<typeof vi.fn> };
    gameEscrow: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

describe("wallet escrow operations", () => {
  it("locks one stake from each player and creates escrow", async () => {
    const tx = createTransactionMock();

    await lockGameStake(tx, {
      gameId: "game-1",
      playerIds: ["player-b", "player-a"],
      stakeMinor: 5000,
    });

    expect(tx.wallet.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountMinor: -5000,
        type: "STAKE_LOCK",
        gameId: "game-1",
        idempotencyKey: "game:game-1:stake:player-a",
      }),
    });
    expect(tx.gameEscrow.create).toHaveBeenCalledWith({
      data: { gameId: "game-1", stakeMinor: 5000 },
    });
  });

  it("pays 90 percent to the winner and books 10 percent as platform fee", async () => {
    const tx = createTransactionMock();
    tx.gameEscrow.findUnique.mockResolvedValue({
      id: "escrow-1",
      stakeMinor: 5000,
      platformFeeBps: 1000,
      status: "HELD",
    });

    await settleGameEscrow(tx, {
      gameId: "game-1",
      result: "WHITE_WIN",
      whiteId: "player-a",
      blackId: "player-b",
    });

    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountType: "USER_WALLET",
        amountMinor: 9000,
        type: "MATCH_PAYOUT",
        idempotencyKey: "game:game-1:payout:player-a",
      }),
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountType: "PLATFORM",
        amountMinor: 1000,
        type: "PLATFORM_FEE",
        idempotencyKey: "game:game-1:fee",
      }),
    });
    expect(tx.gameEscrow.update).toHaveBeenCalledWith({
      where: { id: "escrow-1" },
      data: expect.objectContaining({ status: "SETTLED" }),
    });
  });

  it("refunds both players in full for a draw", async () => {
    const tx = createTransactionMock();
    tx.gameEscrow.findUnique.mockResolvedValue({
      id: "escrow-1",
      stakeMinor: 5000,
      platformFeeBps: 1000,
      status: "HELD",
    });

    await settleGameEscrow(tx, {
      gameId: "game-1",
      result: "DRAW",
      whiteId: "player-a",
      blackId: "player-b",
    });

    expect(tx.ledgerEntry.create).toHaveBeenCalledTimes(3);
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountMinor: 5000, type: "STAKE_REFUND" }),
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountType: "ESCROW",
        amountMinor: -10000,
        type: "ESCROW_RELEASE",
      }),
    });
    expect(tx.gameEscrow.update).toHaveBeenCalledWith({
      where: { id: "escrow-1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
  });

  it("does not settle an escrow twice", async () => {
    const tx = createTransactionMock();
    tx.gameEscrow.findUnique.mockResolvedValue({ id: "escrow-1", status: "SETTLED" });

    await settleGameEscrow(tx, {
      gameId: "game-1",
      result: "WHITE_WIN",
      whiteId: "player-a",
      blackId: "player-b",
    });

    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(tx.gameEscrow.update).not.toHaveBeenCalled();
  });
});
