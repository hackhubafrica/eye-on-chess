CREATE TYPE "LedgerEntryType" AS ENUM (
  'DEPOSIT',
  'STAKE_LOCK',
  'ESCROW_FUNDING',
  'ESCROW_RELEASE',
  'STAKE_REFUND',
  'MATCH_PAYOUT',
  'PLATFORM_FEE'
);

CREATE TYPE "LedgerAccountType" AS ENUM ('USER_WALLET', 'PLATFORM', 'CLEARING', 'ESCROW');
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "EscrowStatus" AS ENUM ('HELD', 'SETTLED', 'REFUNDED');

ALTER TABLE "Game"
ADD COLUMN "stakeMinor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Game"
ADD COLUMN "challengeCreatorId" TEXT;

CREATE INDEX "Game_challengeCreatorId_idx" ON "Game"("challengeCreatorId");

ALTER TABLE "Game"
ADD CONSTRAINT "Game_challengeCreatorId_fkey"
FOREIGN KEY ("challengeCreatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Wallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balanceMinor" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Wallet_balanceMinor_nonnegative" CHECK ("balanceMinor" >= 0)
);

CREATE TABLE "Deposit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "checkoutRequestId" TEXT,
  "receiptNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Deposit_amountMinor_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "GameEscrow" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "stakeMinor" INTEGER NOT NULL,
  "platformFeeBps" INTEGER NOT NULL DEFAULT 1000,
  "status" "EscrowStatus" NOT NULL DEFAULT 'HELD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "GameEscrow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GameEscrow_stakeMinor_positive" CHECK ("stakeMinor" > 0),
  CONSTRAINT "GameEscrow_platformFeeBps_valid" CHECK ("platformFeeBps" BETWEEN 0 AND 10000)
);

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "accountType" "LedgerAccountType" NOT NULL,
  "walletId" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "type" "LedgerEntryType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "gameId" TEXT,
  "depositId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_amountMinor_nonzero" CHECK ("amountMinor" <> 0),
  CONSTRAINT "LedgerEntry_account_wallet_shape" CHECK (
    ("accountType" = 'USER_WALLET' AND "walletId" IS NOT NULL) OR
    ("accountType" = 'PLATFORM' AND "walletId" IS NULL)
  )
);

CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE UNIQUE INDEX "Deposit_idempotencyKey_key" ON "Deposit"("idempotencyKey");
CREATE UNIQUE INDEX "Deposit_checkoutRequestId_key" ON "Deposit"("checkoutRequestId");
CREATE UNIQUE INDEX "Deposit_receiptNumber_key" ON "Deposit"("receiptNumber");
CREATE UNIQUE INDEX "GameEscrow_gameId_key" ON "GameEscrow"("gameId");
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");
CREATE INDEX "Deposit_status_createdAt_idx" ON "Deposit"("status", "createdAt");
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");
CREATE INDEX "LedgerEntry_gameId_idx" ON "LedgerEntry"("gameId");
CREATE INDEX "LedgerEntry_depositId_idx" ON "LedgerEntry"("depositId");

ALTER TABLE "Wallet"
ADD CONSTRAINT "Wallet_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Deposit"
ADD CONSTRAINT "Deposit_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GameEscrow"
ADD CONSTRAINT "GameEscrow_gameId_fkey"
FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_gameId_fkey"
FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_depositId_fkey"
FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;