-- AlterTable
ALTER TABLE "ledger_transactions" ADD COLUMN "destinationAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "accounts_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
