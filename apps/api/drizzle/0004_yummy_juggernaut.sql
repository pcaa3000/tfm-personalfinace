CREATE TABLE "receipts_receipt_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"uploaderSubject" text NOT NULL,
	"storageKey" text NOT NULL,
	"originalFilename" text NOT NULL,
	"mimeType" text NOT NULL,
	"sizeBytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"extractedPayload" jsonb,
	"draftPayload" jsonb,
	"transactionId" text,
	"error" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts_receipt_scans" ADD CONSTRAINT "receipts_receipt_scans_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."ledger_transactions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "receipts_receipt_scans_workspaceId_idx" ON "receipts_receipt_scans" USING btree ("workspaceId");--> statement-breakpoint
-- updatedAt trigger (same convention as 0001): pipeline status updates
-- (T4+) bump updatedAt at the database level even when a writer forgets.
CREATE TRIGGER "receipts_receipt_scans_set_updated_at"
BEFORE UPDATE ON "receipts_receipt_scans"
FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
