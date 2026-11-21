import { randomUUID } from "node:crypto";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleDb, DrizzleSchema } from "../../../drizzle/db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactionRevisions,
  ledgerTransactions,
  ledgerTransactionSplits,
  notifications,
  outboxEvents,
  receiptScans,
  workspaces,
} from "../../../drizzle/schema.js";
import { seedDemoWorkspaceInTransaction } from "../../../drizzle/seed-demo-workspace.js";
import type { CallerIdentity } from "../../identity-workspace/index.js";
import type {
  DemoSession,
  DemoSessionPort,
} from "../application/demo-session.port.js";

/** Demo workspaces carry this kind — the only kind the cleanup wipes. */
export const DEMO_WORKSPACE_KIND = "demo";

/** identityKey prefix for every ephemeral workspace of one subject. */
function demoPrefix(caller: CallerIdentity): string {
  return `${caller.issuer}|${caller.subject}|`;
}

/**
 * Cascade-safe wipe of whole workspaces (demo-maria-session T1, S8):
 * FK children first — splits/revisions reference transactions, scans
 * reference transactions (set null), splits reference categories
 * (restrict) — then the workspace rows themselves. Mirrors the reset
 * order in seedDemoWorkspace plus the tables the reset keeps.
 */
async function deleteWorkspacesCascade(
  tx: DrizzleDb,
  workspaceIds: readonly string[],
): Promise<void> {
  const transactionIds = tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, [...workspaceIds]));
  await tx
    .delete(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.transactionId, transactionIds));
  await tx
    .delete(ledgerTransactionRevisions)
    .where(
      inArray(ledgerTransactionRevisions.transactionId, transactionIds),
    );
  await tx
    .delete(receiptScans)
    .where(inArray(receiptScans.workspaceId, [...workspaceIds]));
  await tx
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, [...workspaceIds]));
  await tx
    .delete(accounts)
    .where(inArray(accounts.workspaceId, [...workspaceIds]));
  await tx
    .delete(outboxEvents)
    .where(inArray(outboxEvents.workspaceId, [...workspaceIds]));
  await tx
    .delete(notifications)
    .where(inArray(notifications.workspaceId, [...workspaceIds]));
  await tx
    .delete(categories)
    .where(inArray(categories.workspaceId, [...workspaceIds]));
  await tx
    .delete(currencies)
    .where(inArray(currencies.workspaceId, [...workspaceIds]));
  await tx
    .delete(workspaces)
    .where(inArray(workspaces.id, [...workspaceIds]));
}

/**
 * Postgres-backed {@link DemoSessionPort}. One transaction per session
 * (S3): a `pg_advisory_xact_lock` keyed on `issuer|subject` serializes
 * concurrent demo sign-ins of the same subject, the subject's stale
 * kind='demo' workspaces are wiped with their data (S8), then the new
 * `issuer|subject|sid` workspace is seeded through the exact same code
 * path as `pnpm db:seed:demo` (S2). A mid-seed failure rolls the whole
 * session back — no half-seeded demo workspace and the previous session
 * state is untouched.
 */
export class DrizzleDemoSessionService implements DemoSessionPort {
  constructor(private readonly db: NodePgDatabase<DrizzleSchema>) {}

  async createSession(caller: CallerIdentity): Promise<DemoSession> {
    const sessionId = randomUUID();
    const identityKey = `${demoPrefix(caller)}${sessionId}`;
    let workspaceId = "";

    await this.db.transaction(async (tx) => {
      // Serialize concurrent demo sign-ins of this subject: the lock is
      // released automatically when the transaction commits/rolls back.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${caller.issuer}|${caller.subject}`}, 0))`,
      );

      const stale = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.kind, DEMO_WORKSPACE_KIND),
            like(workspaces.identityKey, `${demoPrefix(caller)}%`),
          ),
        );
      if (stale.length > 0) {
        await deleteWorkspacesCascade(
          tx,
          stale.map((row) => row.id),
        );
      }

      const seeded = await seedDemoWorkspaceInTransaction(
        tx,
        {
          identityKey,
          workspaceId: randomUUID(),
          kind: DEMO_WORKSPACE_KIND,
        },
        new Date(),
      );
      workspaceId = seeded.workspaceId;
    });

    return { sessionId, workspaceId };
  }
}
