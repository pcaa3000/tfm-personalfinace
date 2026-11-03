-- AlterTable
ALTER TABLE "accounts_accounts" ADD COLUMN "initialBalanceMinor" BIGINT NOT NULL DEFAULT 0;

-- Migrate legacy wallet kind to virtual
UPDATE "accounts_accounts" SET "kind" = 'virtual' WHERE "kind" = 'wallet';
