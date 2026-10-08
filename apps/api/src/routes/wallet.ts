import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ensureWallet, postSystemEntry, postWalletEntry } from "../lib/wallet.js";
import { authMiddleware } from "../middleware/auth.js";
import { apiError } from "../lib/errorCodes.js";

const sandboxCreditBodySchema = z.object({
  amountKes: z.number().int().min(1).max(1000),
});

export async function walletRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  app.get("/wallet", async (request) => {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: request.user.userId },
      include: {
        entries: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    return {
      currency: "KES",
      balanceMinor: wallet?.balanceMinor ?? 0,
      entries: wallet?.entries ?? [],
    };
  });

  app.post("/wallet/sandbox-deposits", async (request, reply) => {
    if (process.env.NODE_ENV === "production" || process.env.PAYMENTS_MODE !== "mock") {
      return apiError(reply, 404, "WALLET_SANDBOX_DISABLED", "Sandbox credits are disabled");
    }

    const parsed = sandboxCreditBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return apiError(reply, 400, "VALIDATION_FAILED", "amountKes must be an integer from 1 to 1000");
    }

    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return apiError(reply, 400, "VALIDATION_FAILED", "A valid Idempotency-Key header is required");
    }

    const amountMinor = parsed.data.amountKes * 100;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.deposit.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.userId !== request.user.userId || existing.amountMinor !== amountMinor) {
          return { conflict: true as const };
        }
        return { conflict: false as const, deposit: existing, replayed: true };
      }

      const deposit = await tx.deposit.create({
        data: {
          userId: request.user.userId,
          amountMinor,
          status: "PENDING",
          idempotencyKey,
          checkoutRequestId: `mock-${randomUUID()}`,
        },
      });
      return { conflict: false as const, deposit, replayed: false };
    });

    if (result.conflict) {
      return apiError(reply, 409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request");
    }

    return reply.status(result.replayed ? 200 : 202).send({
      depositId: result.deposit.id,
      status: result.deposit.status,
      amountMinor: result.deposit.amountMinor,
      checkoutRequestId: result.deposit.checkoutRequestId,
      currency: "KES",
    });
  });

  app.post<{ Params: { id: string } }>(
    "/wallet/sandbox-deposits/:id/confirm",
    async (request, reply) => {
      if (process.env.NODE_ENV === "production" || process.env.PAYMENTS_MODE !== "mock") {
        return apiError(reply, 404, "WALLET_SANDBOX_DISABLED", "Sandbox deposits are disabled");
      }

      const outcome = await prisma.$transaction(async (tx) => {
        const deposit = await tx.deposit.findUnique({ where: { id: request.params.id } });
        if (!deposit || deposit.userId !== request.user.userId) return "not-found" as const;
        if (deposit.status !== "PENDING") return "duplicate" as const;

        const updated = await tx.deposit.updateMany({
          where: { id: deposit.id, userId: request.user.userId, status: "PENDING" },
          data: {
            status: "SUCCEEDED",
            receiptNumber: `SANDBOX-${deposit.id}`,
            confirmedAt: new Date(),
          },
        });
        if (updated.count !== 1) return "duplicate" as const;

        const wallet = await ensureWallet(tx, request.user.userId);
        await postWalletEntry(tx, {
          walletId: wallet.id,
          amountMinor: deposit.amountMinor,
          type: "DEPOSIT",
          idempotencyKey: `deposit:${deposit.id}`,
          depositId: deposit.id,
        });
        await postSystemEntry(tx, {
          accountType: "CLEARING",
          amountMinor: -deposit.amountMinor,
          type: "DEPOSIT",
          idempotencyKey: `deposit:${deposit.id}:clearing`,
          depositId: deposit.id,
        });
        return "confirmed" as const;
      });

      if (outcome === "not-found") {
        return apiError(reply, 404, "PAYMENT_DEPOSIT_NOT_FOUND", "Pending deposit not found");
      }
      return reply.send({ status: "SUCCEEDED", duplicate: outcome === "duplicate" });
    }
  );
}
