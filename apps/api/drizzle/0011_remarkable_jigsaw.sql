CREATE TABLE "reports_period_closes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"currency" text NOT NULL,
	"periodStart" date NOT NULL,
	"periodEnd" date NOT NULL,
	"timezone" text NOT NULL,
	"integrityDeclared" boolean NOT NULL,
	"closedAt" timestamp (3) NOT NULL,
	"invalidatedAt" timestamp (3),
	"supersededAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reports_period_closes_workspaceId_idx" ON "reports_period_closes" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_period_closes_active_key" ON "reports_period_closes" USING btree ("workspaceId","currency","periodStart") WHERE "supersededAt" IS NULL;