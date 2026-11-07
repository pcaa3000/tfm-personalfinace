CREATE TABLE "notifications_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs_outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurredAt" timestamp (3) DEFAULT now() NOT NULL,
	"processedAt" timestamp (3)
);
--> statement-breakpoint
CREATE INDEX "notifications_notifications_workspaceId_idx" ON "notifications_notifications" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "jobs_outbox_events_workspaceId_idx" ON "jobs_outbox_events" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "jobs_outbox_events_pending_idx" ON "jobs_outbox_events" USING btree ("processedAt");