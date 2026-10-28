-- CreateTable
CREATE TABLE "identity_workspace_workspaces" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_workspace_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorization_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "workspaceId" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "categorization_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "originRef" TEXT,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction_revisions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actor" TEXT NOT NULL,

    CONSTRAINT "ledger_transaction_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_workspace_workspaces_identityKey_key" ON "identity_workspace_workspaces"("identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "categorization_categories_key_workspaceId_key" ON "categorization_categories"("key", "workspaceId");

-- CreateIndex
CREATE INDEX "ledger_transactions_workspaceId_businessDate_idx" ON "ledger_transactions"("workspaceId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_workspaceId_idempotencyKey_key" ON "ledger_transactions"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transaction_revisions_transactionId_revisionNumber_key" ON "ledger_transaction_revisions"("transactionId", "revisionNumber");

-- AddForeignKey
ALTER TABLE "ledger_transaction_revisions" ADD CONSTRAINT "ledger_transaction_revisions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
