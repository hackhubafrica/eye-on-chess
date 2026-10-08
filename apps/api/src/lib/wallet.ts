import type { Prisma, LedgerEntryType } from "@prisma/client";

export class InsufficientWalletFundsError extends Error {
  constructor() {
    super("Insufficient wallet funds");
    this.name = "InsufficientWalletFundsError";
  }
}

export async function ensureWallet(tx: Prisma.TransactionClient, userId: string) {
  return tx.wallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function postWalletEntry(
  tx: Prisma.TransactionClient,
  input: {
    walletId: string;
    amountMinor: number;
    type: LedgerEntryType;
    idempotencyKey: string;
    gameId?: string;
    depositId?: string;
  }
) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
    throw new Error("Ledger amount must be a non-zero safe integer");
  }

  const existing = await tx.ledgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const updated = await tx.wallet.updateMany({
    where: {
      id: input.walletId,
      ...(input.amountMinor < 0 ? { balanceMinor: { gte: -input.amountMinor } } : {}),
    },
    data: { balanceMinor: { increment: input.amountMinor } },
  });

  if (updated.count !== 1) {
    if (input.amountMinor < 0) throw new InsufficientWalletFundsError();
    throw new Error("Wallet not found");
  }

  return tx.ledgerEntry.create({
    data: {
      accountType: "USER_WALLET",
      walletId: input.walletId,
      amountMinor: input.amountMinor,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      gameId: input.gameId,
      depositId: input.depositId,
    },
  });
}

export async function postPlatformEntry(
  tx: Prisma.TransactionClient,
  input: {
    amountMinor: number;
    type: LedgerEntryType;
    idempotencyKey: string;
    gameId: string;
  }
) {
  if (input.amountMinor <= 0) throw new Error("Platform ledger amount must be positive");
  return postSystemEntry(tx, { ...input, accountType: "PLATFORM" });
}

export async function postSystemEntry(
  tx: Prisma.TransactionClient,
  input: {
    accountType: "PLATFORM" | "CLEARING" | "ESCROW";
    amountMinor: number;
    type: LedgerEntryType;
    idempotencyKey: string;
    gameId?: string;
    depositId?: string;
  }
) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
    throw new Error("System ledger amount must be a non-zero safe integer");
  }

  const existing = await tx.ledgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  return tx.ledgerEntry.create({
    data: {
      accountType: input.accountType,
      amountMinor: input.amountMinor,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      gameId: input.gameId,
      depositId: input.depositId,
    },
  });
}

export async function lockGameStake(
  tx: Prisma.TransactionClient,
  input: { gameId: string; playerIds: [string, string]; stakeMinor: number }
) {
  if (!Number.isSafeInteger(input.stakeMinor) || input.stakeMinor <= 0) {
    throw new Error("Stake must be a positive safe integer");
  }

  for (const userId of [...input.playerIds].sort()) {
    const wallet = await ensureWallet(tx, userId);
    await postWalletEntry(tx, {
      walletId: wallet.id,
      amountMinor: -input.stakeMinor,
      type: "STAKE_LOCK",
      idempotencyKey: `game:${input.gameId}:stake:${userId}`,
      gameId: input.gameId,
    });
  }

  await postSystemEntry(tx, {
    accountType: "ESCROW",
    amountMinor: input.stakeMinor * 2,
    type: "ESCROW_FUNDING",
    idempotencyKey: `game:${input.gameId}:escrow-funding`,
    gameId: input.gameId,
  });

  return tx.gameEscrow.create({
    data: { gameId: input.gameId, stakeMinor: input.stakeMinor },
  });
}

export async function settleGameEscrow(
  tx: Prisma.TransactionClient,
  input: {
    gameId: string;
    result: "WHITE_WIN" | "BLACK_WIN" | "DRAW" | "ABORTED";
    whiteId: string | null;
    blackId: string | null;
  }
) {
  const escrow = await tx.gameEscrow.findUnique({ where: { gameId: input.gameId } });
  if (!escrow || escrow.status !== "HELD") return;

  if (!input.whiteId || !input.blackId) {
    throw new Error("Escrow game must have two players");
  }
  const whiteId = input.whiteId;
  const blackId = input.blackId;
  const playerIds: [string, string] = [whiteId, blackId];

  if (input.result === "DRAW" || input.result === "ABORTED") {
    for (const userId of [...playerIds].sort()) {
      const wallet = await ensureWallet(tx, userId);
      await postWalletEntry(tx, {
        walletId: wallet.id,
        amountMinor: escrow.stakeMinor,
        type: "STAKE_REFUND",
        idempotencyKey: `game:${input.gameId}:refund:${userId}`,
        gameId: input.gameId,
      });
    }
    await postSystemEntry(tx, {
      accountType: "ESCROW",
      amountMinor: -escrow.stakeMinor * 2,
      type: "ESCROW_RELEASE",
      idempotencyKey: `game:${input.gameId}:escrow-refund`,
      gameId: input.gameId,
    });
    await tx.gameEscrow.update({
      where: { id: escrow.id },
      data: { status: "REFUNDED", settledAt: new Date() },
    });
    return;
  }

  const winnerId = input.result === "WHITE_WIN" ? whiteId : blackId;
  const winnerWallet = await ensureWallet(tx, winnerId);
  const potMinor = escrow.stakeMinor * 2;
  const feeMinor = Math.floor((potMinor * escrow.platformFeeBps) / 10_000);
  const payoutMinor = potMinor - feeMinor;

  await postSystemEntry(tx, {
    accountType: "ESCROW",
    amountMinor: -potMinor,
    type: "ESCROW_RELEASE",
    idempotencyKey: `game:${input.gameId}:escrow-release`,
    gameId: input.gameId,
  });
  await postWalletEntry(tx, {
    walletId: winnerWallet.id,
    amountMinor: payoutMinor,
    type: "MATCH_PAYOUT",
    idempotencyKey: `game:${input.gameId}:payout:${winnerId}`,
    gameId: input.gameId,
  });
  if (feeMinor > 0) {
    await postPlatformEntry(tx, {
      amountMinor: feeMinor,
      type: "PLATFORM_FEE",
      idempotencyKey: `game:${input.gameId}:fee`,
      gameId: input.gameId,
    });
  }

  await tx.gameEscrow.update({
    where: { id: escrow.id },
    data: { status: "SETTLED", settledAt: new Date() },
  });
}
