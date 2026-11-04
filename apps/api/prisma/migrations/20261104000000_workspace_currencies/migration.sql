-- CreateTable
CREATE TABLE "currencies_currencies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_currencies_workspaceId_code_key" ON "currencies_currencies"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "currencies_currencies_workspaceId_idx" ON "currencies_currencies"("workspaceId");

-- Backfill: every existing workspace starts its catalog with its
-- defaultCurrency (INV-MON-01..03 bootstrap; T18 decision documented in
-- odd/tasks/ledger-income-expenses.md).
INSERT INTO "currencies_currencies" ("id", "workspaceId", "code", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "defaultCurrency", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "identity_workspace_workspaces";
