import { timingSafeEqual } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ensureWallet, postSystemEntry, postWalletEntry } from "../lib/wallet.js";
import { apiError } from "../lib/errorCodes.js";

const sandboxCallbackSchema = z.object({
  checkoutRequestId: z.string().min(1).max(128),
  resultCode: z.number().int(),
  receiptNumber: z.string().min(1).max(64).optional(),
});

function sandboxCallbackTokenMatches(provided: string | undefined) {
  const expected = process.env.MPESA_SANDBOX_CALLBACK_TOKEN;
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function paymentRoutes(app: FastifyInstance) {
  app.post("/payments/mpesa/sandbox-callback", async (request, reply) => {
    if (process.env.NODE_ENV === "production" || process.env.PAYMENTS_MODE !== "mock") {
      return apiError(reply, 404, "PAYMENT_SANDBOX_DISABLED", "Sandbox payments are disabled");
    }
    const callbackToken = request.headers["x-sandbox-callback-token"];
    if (!sandboxCallbackTokenMatches(Array.isArray(callbackToken) ? callbackToken[0] : callbackToken)) {
      return apiError(reply, 401, "PAYMENT_CALLBACK_UNAUTHORIZED", "Invalid callback token");
    }

    const parsed = sandboxCallbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return apiError(reply, 400, "VALIDATION_FAILED", "Invalid payment callback payload");
    }
    if (parsed.data.resultCode === 0 && !parsed.data.receiptNumber) {
      return apiError(reply, 400, "VALIDATION_FAILED", "Successful callback requires a receipt number");
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { checkoutRequestId: parsed.data.checkoutRequestId },
      });
      if (!deposit) return "not-found" as const;
      if (deposit.status !== "PENDING") return "duplicate" as const;

      const successful = parsed.data.resultCode === 0;
      const updated = await tx.deposit.updateMany({
        where: { id: deposit.id, status: "PENDING" },
        data: successful
          ? {
              status: "SUCCEEDED",
              receiptNumber: parsed.data.receiptNumber,
              confirmedAt: new Date(),
            }
          : { status: "FAILED" },
      });
      if (updated.count !== 1) return "duplicate" as const;

      if (successful) {
        const wallet = await ensureWallet(tx, deposit.userId);
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
      }
      return "accepted" as const;
    });

    if (outcome === "not-found") {
      return apiError(reply, 404, "PAYMENT_DEPOSIT_NOT_FOUND", "Deposit not found");
    }
    return reply.status(200).send({ accepted: true, duplicate: outcome === "duplicate" });
  });
}
