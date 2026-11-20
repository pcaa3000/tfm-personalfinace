-- receipt-retention-30d T1 (S1+S2): expiresAt is NOT NULL, so the column
-- lands nullable, backfills from createdAt + 30 days for existing rows,
-- then the constraint is set.
ALTER TABLE "receipts_receipt_scans" ADD COLUMN "expiresAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "receipts_receipt_scans" ADD COLUMN "mediaDeletedAt" timestamp (3);--> statement-breakpoint
UPDATE "receipts_receipt_scans" SET "expiresAt" = "createdAt" + interval '30 days' WHERE "expiresAt" IS NULL;--> statement-breakpoint
ALTER TABLE "receipts_receipt_scans" ALTER COLUMN "expiresAt" SET NOT NULL;
