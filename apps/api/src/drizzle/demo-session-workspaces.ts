import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleDb, DrizzleSchema } from "./db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactionRevisions,
  ledgerTransactions,
  ledgerTransactionSplits,
  notifications,
  outboxEvents,
  periodCloses,
  receiptScans,
  voiceConsents,
  voiceNotes,
  workspaces,
} from "./schema.js";
import { buildDemoPlan, demoWindowMonths } from "./seed-demo-data.js";
import {
  bootstrapDemoWorkspace,
  demoCategoryIdByKey,
  ensureDemoAccounts,
  recordDemoTransactions,
  wipeDemoWorkspaceState,
  type DemoWorkspaceTarget,
} from "./seed-demo-workspace.js";
/**
 * Per-session ephemeral "María" demo workspaces (odd/tasks/
 * demo-maria-session T6+T7 — L10 final model, restoring the L3 per-sid
 * approach): every demo sign-in gets its own `issuer|subject|sid`
 * workspace of kind `demo`, seeded asynchronously so POST
 * /demo/session answers immediately while the web still gets data
 * soon — the workspace row exists before the response and each month
 * commits separately, in spec order (current, then -1 … -5).
 *
 * The file carries the three pieces the model shares:
 *
 * - {@link seedDemoSessionWorkspace} — the async seed job body:
 *   bootstrap + wipe + the 4 seed accounts, then one transaction per
 *   window month in order (`buildDemoPlan(now, {months})` filtering,
 *   same helpers as `refreshDemoWorkspace`), each behind a
 *   `pg_advisory_xact_lock` keyed on the session identity key.
 * - {@link cleanupDemoWorkspaces} — the >24h orphan sweep (T7): wipes
 *   kind='demo' workspaces (any subject) created before the cutoff
 *   with ALL their data via {@link deleteWorkspacesCascade}. Called by
 *   the seed job after seeding, by DELETE /demo/session and by the
 *   `pnpm db:demo:cleanup` script.
 * - {@link DemoSessionSeedTrigger} — the in-process, per-sid mutex the
 *   session endpoint kicks fire-and-forget (same pattern as
 *   `DemoRefreshTrigger`): at most one run per sid, failures are
 *   logged and swallowed so they can never crash the request path.
 */

/** Ephemeral per-session demo workspaces carry this kind — the only kind the orphan sweep may delete. */
export const DEMO_WORKSPACE_KIND = "demo";

/** Orphan demo workspaces expire 24h after creation (L10/T7). */
export const DEMO_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Cutoff instant for the orphan sweep: `now − 24h`. */
export function demoOrphanCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DEMO_ORPHAN_MAX_AGE_MS);
}

/**
 * Cascade-safe wipe of whole workspaces (FK children first —
 * splits/revisions reference transactions, scans and voice notes
 * reference transactions (set null), splits reference categories
 * (restrict) — then the workspace rows themselves). Mirrors the reset
 * order in `wipeDemoWorkspaceState` plus the tables the reset keeps
 * (categories, currencies, the workspace row). Voice notes, voice
 * consents and period closes carry a plain-text workspaceId with no
 * FK, so the delete is what keeps them from leaking (S5).
 */
export async function deleteWorkspacesCascade(
  tx: DrizzleDb,
  workspaceIds: readonly string[],
): Promise<void> {
  if (workspaceIds.length === 0) return;
  const ids = [...workspaceIds];
  const transactionIds = tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, ids));
  await tx
    .delete(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.transactionId, transactionIds));
  await tx
    .delete(ledgerTransactionRevisions)
    .where(
      inArray(ledgerTransactionRevisions.transactionId, transactionIds),
    );
  await tx.delete(receiptScans).where(inArray(receiptScans.workspaceId, ids));
  await tx.delete(voiceNotes).where(inArray(voiceNotes.workspaceId, ids));
  await tx
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, ids));
  await tx.delete(accounts).where(inArray(accounts.workspaceId, ids));
  await tx.delete(outboxEvents).where(inArray(outboxEvents.workspaceId, ids));
  await tx
    .delete(notifications)
    .where(inArray(notifications.workspaceId, ids));
  await tx
    .delete(voiceConsents)
    .where(inArray(voiceConsents.workspaceId, ids));
  await tx
    .delete(periodCloses)
    .where(inArray(periodCloses.workspaceId, ids));
  await tx.delete(categories).where(inArray(categories.workspaceId, ids));
  await tx.delete(currencies).where(inArray(currencies.workspaceId, ids));
  await tx.delete(workspaces).where(inArray(workspaces.id, ids));
}

export interface CleanupDemoWorkspacesOptions {
  /**
   * Cutoff instant: kind='demo' workspaces with `createdAt` BEFORE
   * this instant are deleted. Callers pass {@link demoOrphanCutoff}.
   */
  readonly olderThan: Date;
}

export interface CleanupDemoWorkspacesResult {
  /** Ids of the workspaces the sweep deleted (with all their data). */
  readonly deletedWorkspaceIds: readonly string[];
}

/**
 * Orphan sweep (T7, L10): deletes every kind='demo' workspace —
 * whatever its subject — whose `createdAt` is older than the cutoff,
 * with all its data. Transaction-bound so callers can compose it with
 * their own deletes inside ONE transaction (DELETE /demo/session does
 * the session delete + the sweep atomically).
 */
export async function cleanupDemoWorkspacesInTransaction(
  tx: DrizzleDb,
  options: CleanupDemoWorkspacesOptions,
): Promise<CleanupDemoWorkspacesResult> {
  const orphans = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.kind, DEMO_WORKSPACE_KIND),
        lt(workspaces.createdAt, options.olderThan),
      ),
    );
  const ids = orphans.map((row) => row.id);
  await deleteWorkspacesCascade(tx, ids);
  return { deletedWorkspaceIds: ids };
}

/**
 * Standalone wrapper of {@link cleanupDemoWorkspacesInTransaction} for
 * callers that own no transaction (the async seed job, the
 * `pnpm db:demo:cleanup` script).
 */
export async function cleanupDemoWorkspaces(
  db: NodePgDatabase<DrizzleSchema>,
  options: CleanupDemoWorkspacesOptions,
): Promise<CleanupDemoWorkspacesResult> {
  return db.transaction((tx) =>
    cleanupDemoWorkspacesInTransaction(tx, options),
  );
}

export interface SeedDemoSessionWorkspaceOptions {
  /** Session workspace identity key: `issuer|subject|sid`. */
  readonly identityKey: string;
  /** Id used when the workspace row must be created. */
  readonly workspaceId: string;
  /** Clock seam for specs — anchors "today" in the demo timezone. */
  readonly now?: Date;
}

export interface SeedDemoSessionWorkspaceResult {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly workspaceCreated: boolean;
  readonly accountsCreated: number;
  /** "YYYY-MM" keys generated, in spec order (current, -1..-5). */
  readonly generatedMonths: readonly string[];
  readonly insertedTransactions: number;
  /**
   * True when the session workspace row was already gone before the
   * scaffolding step ran (R1-001): the job aborted instead of letting
   * {@link bootstrapDemoWorkspace} resurrect an ended session.
   */
  readonly aborted: boolean;
}

/**
 * `pg_advisory_xact_lock` keyed on the session identity key (R1-001):
 * shared by {@link seedDemoSessionWorkspace} (every step) and
 * `endSession` so a DELETE /demo/session serializes with an in-flight
 * seed step instead of colliding on FK RESTRICT.
 */
export function demoSessionAdvisoryLock(identityKey: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))`;
}

/**
 * Async seed job for one session workspace (S3, L10): bootstrap the
 * `issuer|subject|sid` kind='demo' workspace (created by POST
 * /demo/session before the response — {@link bootstrapDemoWorkspace}
 * adopts it and adds the PEN currency + catalog copies), wipe any
 * partial state so a retried job stays idempotent, ensure the four
 * seed accounts, then generate transactions month by month in the
 * spec's order — current, -1..-5 — each in its own committed
 * transaction so the current month's data is visible to the web while
 * the older months are still generating.
 *
 * Every transaction takes a `pg_advisory_xact_lock` keyed on the
 * identity key so concurrent jobs for the same sid serialize across
 * processes; each month also re-checks the workspace still exists so
 * a DELETE /demo/session mid-seed aborts the remaining months instead
 * of resurrecting ledger rows for a deleted workspace.
 *
 * R1-001: the scaffolding step checks the pre-created session row is
 * still there INSIDE the lock — its absence means the session was
 * ended (DELETE or orphan sweep) while the job was queued, so the job
 * aborts instead of letting the bootstrap re-create the row.
 */
export async function seedDemoSessionWorkspace(
  db: NodePgDatabase<DrizzleSchema>,
  options: SeedDemoSessionWorkspaceOptions,
): Promise<SeedDemoSessionWorkspaceResult> {
  const now = options.now ?? new Date();
  const target: DemoWorkspaceTarget = {
    identityKey: options.identityKey,
    workspaceId: options.workspaceId,
    kind: DEMO_WORKSPACE_KIND,
  };
  const advisoryLock = demoSessionAdvisoryLock(options.identityKey);

  const scaffolding = await db.transaction(async (tx) => {
    await tx.execute(advisoryLock);
    // R1-001: POST /demo/session pre-creates this row before the job
    // is kicked; its absence inside the lock means the session was
    // ended meanwhile — abort rather than resurrect it below.
    const [sessionRow] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.identityKey, options.identityKey),
          eq(workspaces.kind, DEMO_WORKSPACE_KIND),
        ),
      )
      .limit(1);
    if (!sessionRow) return null;
    const { workspace, workspaceId, created } =
      await bootstrapDemoWorkspace(tx, target);
    // Re-seed semantics (S4): the wipe only makes sense when the
    // workspace pre-existed — a previous crashed job may have left
    // partial ledger/account state. A workspace bootstrap just created
    // has nothing to wipe, so the deletes are skipped entirely.
    if (!created) {
      await wipeDemoWorkspaceState(tx, workspace.id);
    }
    const categoryIdByKey = await demoCategoryIdByKey(tx, workspace.id);
    const { accountIdByKey, created: accountsCreated } =
      await ensureDemoAccounts(tx, workspaceId);
    return {
      workspaceId,
      workspaceRowId: workspace.id,
      workspaceCreated: created,
      accountsCreated,
      categoryIdByKey,
      accountIdByKey,
    };
  });

  if (scaffolding === null) {
    return {
      identityKey: options.identityKey,
      workspaceId: options.workspaceId,
      workspaceCreated: false,
      accountsCreated: 0,
      generatedMonths: [],
      insertedTransactions: 0,
      aborted: true,
    };
  }

  const generatedMonths: string[] = [];
  let insertedTransactions = 0;
  // Spec order (S3): current month first so the web gets data soon,
  // then -1 and -2. Each month commits independently.
  for (const month of demoWindowMonths(now)) {
    const inserted = await db.transaction(async (tx) => {
      await tx.execute(advisoryLock);
      // Abort remaining months when the session workspace was deleted
      // mid-seed (logout or an orphan sweep of a backdated row).
      const [alive] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.identityKey, options.identityKey),
            eq(workspaces.kind, DEMO_WORKSPACE_KIND),
          ),
        )
        .limit(1);
      if (!alive) return 0;
      const plan = buildDemoPlan(now, { months: [month.key] });
      const { counts } = await recordDemoTransactions(tx, {
        workspaceId: scaffolding.workspaceId,
        transactions: plan.transactions,
        accountIdByKey: scaffolding.accountIdByKey,
        categoryIdByKey: scaffolding.categoryIdByKey,
      });
      return counts.income + counts.expense + counts.transfer;
    });
    if (inserted > 0) {
      generatedMonths.push(month.key);
      insertedTransactions += inserted;
    }
  }

  return {
    identityKey: options.identityKey,
    workspaceId: scaffolding.workspaceId.value,
    workspaceCreated: scaffolding.workspaceCreated,
    accountsCreated: scaffolding.accountsCreated,
    generatedMonths,
    insertedTransactions,
    aborted: false,
  };
}

/** Target of a {@link DemoSessionSeedTrigger} run. */
export interface DemoSessionSeedTarget {
  readonly identityKey: string;
  readonly workspaceId: string;
}

/**
 * In-process, per-sid serialization for the fire-and-forget session
 * seed trigger (T6, S8): POST /api/v1/demo/session returns 201
 * immediately and kicks the seeding through this coordinator — at
 * most one run per session identity key (extra kicks while one is in
 * flight coalesce to a no-op), failures are logged and swallowed so
 * they can never crash the request path, and the pg advisory lock
 * inside {@link seedDemoSessionWorkspace} still serializes across
 * processes.
 */
export class DemoSessionSeedTrigger {
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    private readonly run: (target: DemoSessionSeedTarget) => Promise<unknown>,
  ) {}

  trigger(target: DemoSessionSeedTarget): void {
    if (this.jobs.has(target.identityKey)) {
      return;
    }
    const job = (async () => {
      try {
        await this.run(target);
      } catch (error) {
        console.error("[api] demo session seed failed:", error);
      } finally {
        this.jobs.delete(target.identityKey);
      }
    })();
    this.jobs.set(target.identityKey, job);
  }

  /**
   * Spec/ops seam: resolves once every in-flight seed job settles —
   * lets integration specs observe the completed background work
   * without sleeping.
   */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.jobs.values()]);
  }
}
