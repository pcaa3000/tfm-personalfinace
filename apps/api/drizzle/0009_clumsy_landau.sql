CREATE TABLE "voices_voice_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"subject" text NOT NULL,
	"provider" text NOT NULL,
	"grantedAt" timestamp (3),
	"revokedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "voices_voice_consents_workspaceId_subject_provider_key" ON "voices_voice_consents" USING btree ("workspaceId","subject","provider");