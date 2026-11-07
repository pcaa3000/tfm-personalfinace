CREATE TABLE "accounts_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"initialBalanceMinor" bigint DEFAULT 0 NOT NULL,
	"archivedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"nature" text NOT NULL,
	"workspaceId" text,
	"archivedAt" timestamp (3)
);
--> statement-breakpoint
CREATE TABLE "currencies_currencies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"code" text NOT NULL,
	"archivedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"transactionId" text NOT NULL,
	"revisionNumber" integer NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	"occurredAt" timestamp (3) NOT NULL,
	"actor" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"type" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"currency" text NOT NULL,
	"businessDate" date NOT NULL,
	"timezone" text NOT NULL,
	"concept" text NOT NULL,
	"accountId" text,
	"destinationAccountId" text,
	"categoryId" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"originRef" text,
	"confirmedAt" timestamp (3) NOT NULL,
	"confirmedBy" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_workspace_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"identityKey" text NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"defaultCurrency" text DEFAULT 'USD' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction_revisions" ADD CONSTRAINT "ledger_transaction_revisions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."accounts_accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "public"."accounts_accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_accounts_workspaceId_name_key" ON "accounts_accounts" USING btree ("workspaceId","name");--> statement-breakpoint
CREATE INDEX "accounts_accounts_workspaceId_idx" ON "accounts_accounts" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "categorization_categories_key_workspaceId_key" ON "categorization_categories" USING btree ("key","workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_currencies_workspaceId_code_key" ON "currencies_currencies" USING btree ("workspaceId","code");--> statement-breakpoint
CREATE INDEX "currencies_currencies_workspaceId_idx" ON "currencies_currencies" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transaction_revisions_transactionId_revisionNumber_key" ON "ledger_transaction_revisions" USING btree ("transactionId","revisionNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_workspaceId_idempotencyKey_key" ON "ledger_transactions" USING btree ("workspaceId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "ledger_transactions_workspaceId_businessDate_idx" ON "ledger_transactions" USING btree ("workspaceId","businessDate");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_workspace_workspaces_identityKey_key" ON "identity_workspace_workspaces" USING btree ("identityKey");