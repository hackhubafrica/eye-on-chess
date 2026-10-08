ALTER TABLE "LedgerEntry"
DROP CONSTRAINT "LedgerEntry_account_wallet_shape";

ALTER TABLE "LedgerEntry"
ADD CONSTRAINT "LedgerEntry_account_wallet_shape" CHECK (
  ("accountType" = 'USER_WALLET' AND "walletId" IS NOT NULL) OR
  ("accountType" IN ('PLATFORM', 'CLEARING', 'ESCROW') AND "walletId" IS NULL)
);