CREATE TABLE "ledger_transaction_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"transactionId" text NOT NULL,
	"categoryId" text NOT NULL,
	"amountMinor" bigint NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction_splits" ADD CONSTRAINT "ledger_transaction_splits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_transaction_splits" ADD CONSTRAINT "ledger_transaction_splits_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."categorization_categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transaction_splits_transactionId_position_key" ON "ledger_transaction_splits" USING btree ("transactionId","position");--> statement-breakpoint
CREATE INDEX "ledger_transaction_splits_transactionId_idx" ON "ledger_transaction_splits" USING btree ("transactionId");