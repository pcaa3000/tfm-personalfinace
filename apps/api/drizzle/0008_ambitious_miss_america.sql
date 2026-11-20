CREATE TABLE "voices_voice_notes" (
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
	"transcript" text,
	"transactionId" text,
	"fileHash" text,
	"error" text,
	"expiresAt" timestamp (3) NOT NULL,
	"mediaDeletedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voices_voice_notes" ADD CONSTRAINT "voices_voice_notes_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."ledger_transactions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "voices_voice_notes_workspaceId_idx" ON "voices_voice_notes" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "voices_voice_notes_workspaceId_fileHash_key" ON "voices_voice_notes" USING btree ("workspaceId","fileHash");