import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma, type FastifyInstance, createApp } from "../test/setup.js";
import { paymentRoutes } from "./payments.js";

describe("paymentRoutes", () => {
  let app: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPaymentsMode = process.env.PAYMENTS_MODE;
  const originalCallbackToken = process.env.MPESA_SANDBOX_CALLBACK_TOKEN;

  beforeAll(async () => {
    app = await createApp(async (instance) => {
      await instance.register(paymentRoutes);
    });
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPaymentsMode === undefined) delete process.env.PAYMENTS_MODE;
    else process.env.PAYMENTS_MODE = originalPaymentsMode;
    if (originalCallbackToken === undefined) delete process.env.MPESA_SANDBOX_CALLBACK_TOKEN;
    else process.env.MPESA_SANDBOX_CALLBACK_TOKEN = originalCallbackToken;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "development";
    process.env.PAYMENTS_MODE = "mock";
    process.env.MPESA_SANDBOX_CALLBACK_TOKEN = "sandbox-token-123";
  });

  it("credits a successful deposit only after its pending state is claimed", async () => {
    const prisma = getPrisma();
    prisma.deposit.findUnique.mockResolvedValue({
      id: "deposit-1",
      userId: "user-1",
      amountMinor: 5000,
      status: "PENDING",
    });
    prisma.deposit.updateMany.mockResolvedValue({ count: 1 });
    prisma.wallet.upsert.mockResolvedValue({ id: "wallet-1" });
    prisma.ledgerEntry.findUnique.mockResolvedValue(null);
    prisma.wallet.updateMany.mockResolvedValue({ count: 1 });
    prisma.ledgerEntry.create.mockResolvedValue({ id: "entry-1" });

    const response = await app.inject({
      method: "POST",
      url: "/payments/mpesa/sandbox-callback",
      headers: { "x-sandbox-callback-token": "sandbox-token-123" },
      payload: {
        checkoutRequestId: "mock-checkout-1",
        resultCode: 0,
        receiptNumber: "MOCK-RECEIPT-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, duplicate: false });
    expect(prisma.deposit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "deposit-1", status: "PENDING" },
        data: expect.objectContaining({ status: "SUCCEEDED", receiptNumber: "MOCK-RECEIPT-1" }),
      })
    );
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountMinor: 5000,
        type: "DEPOSIT",
        depositId: "deposit-1",
      }),
    });
  });

  it("does not credit a repeated callback", async () => {
    const prisma = getPrisma();
    prisma.deposit.findUnique.mockResolvedValue({
      id: "deposit-1",
      userId: "user-1",
      amountMinor: 5000,
      status: "SUCCEEDED",
    });

    const response = await app.inject({
      method: "POST",
      url: "/payments/mpesa/sandbox-callback",
      headers: { "x-sandbox-callback-token": "sandbox-token-123" },
      payload: { checkoutRequestId: "mock-checkout-1", resultCode: 0, receiptNumber: "MOCK-RECEIPT-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).duplicate).toBe(true);
    expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects callbacks with an invalid token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/payments/mpesa/sandbox-callback",
      headers: { "x-sandbox-callback-token": "wrong-token" },
      payload: { checkoutRequestId: "mock-checkout-1", resultCode: 0, receiptNumber: "MOCK-RECEIPT-1" },
    });

    expect(response.statusCode).toBe(401);
    expect(getPrisma().$transaction).not.toHaveBeenCalled();
  });
});
