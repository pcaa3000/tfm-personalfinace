-- AlterTable
ALTER TABLE "ledger_transactions" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "accounts_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bank',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_accounts_workspaceId_idx" ON "accounts_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_accounts_workspaceId_name_key" ON "accounts_accounts"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
