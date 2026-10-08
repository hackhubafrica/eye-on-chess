import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma, authHeader, TEST_USER, type FastifyInstance, createApp } from "../test/setup.js";
import { walletRoutes } from "./wallet.js";

describe("walletRoutes", () => {
  let app: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPaymentsMode = process.env.PAYMENTS_MODE;

  beforeAll(async () => {
    app = await createApp(async (instance) => {
      await instance.register(walletRoutes);
    });
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPaymentsMode === undefined) delete process.env.PAYMENTS_MODE;
    else process.env.PAYMENTS_MODE = originalPaymentsMode;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "development";
    process.env.PAYMENTS_MODE = "mock";
  });

  it("returns zero balance when the user has no wallet", async () => {
    const prisma = getPrisma();
    prisma.wallet.findUnique.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/wallet", headers: authHeader() });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ currency: "KES", balanceMinor: 0, entries: [] });
  });

  it("blocks sandbox deposits in production", async () => {
    process.env.NODE_ENV = "production";

    const response = await app.inject({
      method: "POST",
      url: "/wallet/sandbox-deposits",
      headers: { ...authHeader(), "idempotency-key": "sandbox-test-0001" },
      payload: { amountKes: 50 },
    });

    expect(response.statusCode).toBe(404);
    expect(getPrisma().$transaction).not.toHaveBeenCalled();
  });

  it("creates a pending sandbox deposit using an idempotency key", async () => {
    const prisma = getPrisma();
    prisma.deposit.findUnique.mockResolvedValue(null);
    prisma.deposit.create.mockResolvedValue({
      id: "deposit-1",
      userId: TEST_USER.id,
      amountMinor: 5000,
      status: "PENDING",
      checkoutRequestId: "mock-checkout-1",
    });

    const response = await app.inject({
      method: "POST",
      url: "/wallet/sandbox-deposits",
      headers: { ...authHeader(), "idempotency-key": "sandbox-test-0001" },
      payload: { amountKes: 50 },
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      depositId: "deposit-1",
      status: "PENDING",
      amountMinor: 5000,
      checkoutRequestId: "mock-checkout-1",
      currency: "KES",
    });
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
  });

  it("blocks mock confirmation in production", async () => {
    process.env.NODE_ENV = "production";

    const response = await app.inject({
      method: "POST",
      url: "/wallet/sandbox-deposits/deposit-1/confirm",
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
    expect(getPrisma().$transaction).not.toHaveBeenCalled();
  });

  it("does not allow a user to confirm another user's deposit", async () => {
    const prisma = getPrisma();
    prisma.deposit.findUnique.mockResolvedValue({
      id: "deposit-1",
      userId: "someone-else",
      amountMinor: 5000,
      status: "PENDING",
    });

    const response = await app.inject({
      method: "POST",
      url: "/wallet/sandbox-deposits/deposit-1/confirm",
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
  });

  it("confirms an owned pending deposit with balanced ledger entries", async () => {
    const prisma = getPrisma();
    prisma.deposit.findUnique.mockResolvedValue({
      id: "deposit-1",
      userId: TEST_USER.id,
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
      url: "/wallet/sandbox-deposits/deposit-1/confirm",
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "SUCCEEDED", duplicate: false });
    expect(prisma.deposit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "deposit-1", userId: TEST_USER.id, status: "PENDING" },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      })
    );
    expect(prisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
  });
});
