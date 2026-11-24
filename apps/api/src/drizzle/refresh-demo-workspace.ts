import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleSchema } from "./db.js";
import { buildDemoPlan, demoWindowMonths } from "./seed-demo-data.js";
import {
  bootstrapDemoWorkspace,
  demoCategoryIdByKey,
  ensureDemoAccounts,
  recordDemoTransactions,
  seedDemoPeriodCloses,
  wipeDemoWorkspaceState,
  type DemoWorkspaceTarget,
} from "./seed-demo-workspace.js";
import type { CallerIdentity } from "../modules/identity-workspace/index.js";

/**
 * Rolling 6-month refresh for the shared "María" demo workspace
 * (odd/tasks/demo-maria-session T2, S2/S3/S4; S6 restore semantics):
 * the demo subject keeps ONE workspace `<issuer>|<demo-sub>` —
 * `oidc: <OIDC_ISSUER>|<demo-uid>`, `dev: local|demo-maria` — and every
 * demo sign-in plus the `pnpm db:seed:demo:refresh` script run this
 * routine:
 *
 * 1. Bootstrap — if the workspace does not exist yet, create it with the
 *    PEN currency, the 12 workspace category copies and the four seed
 *    accounts (same building blocks as `seedDemoWorkspace`).
 * 2. Wipe — delete the workspace-scoped ledger state exactly like
 *    `seedDemoWorkspaceInTransaction`'s reset: splits → revisions →
 *    transactions → accounts → outbox events → notifications. This is
 *    S6: a visitor's writes inside a demo session are discarded by the
 *    NEXT refresh, and previously left outbox/notification rows never
 *    accumulate.
 * 3. Re-seed — recreate the four seed accounts and record the
 *    deterministic plan filtered to the rolling window (current month,
 *    -1..-5) through RecordManualTransactionUseCase, so the dataset
 *    stays inside the window and every INV-* invariant is enforced by
 *    construction.
 *
 * Everything runs in ONE transaction behind a `pg_advisory_xact_lock`
 * keyed on the identity key, so concurrent refreshes (two logins, the
 * CLI plus the endpoint, another replica) serialize instead of racing.
 */

export interface RefreshDemoWorkspaceOptions {
  /** Workspace identity key: `<issuer>|<demo-subject>`. */
  readonly identityKey: string;
  /** Id used only when the workspace row has to be created. */
  readonly workspaceId: string;
  /** Clock seam for specs — anchors "today" in the demo timezone. */
  readonly now?: Date;
}

export interface RefreshDemoWorkspaceResult {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly workspaceCreated: boolean;
  readonly accountsCreated: number;
  /** Ledger transactions wiped before the re-seed (S6 restore). */
  readonly purgedTransactions: number;
  /** "YYYY-MM" keys (current, -1..-5 order) that were generated. */
  readonly generatedMonths: readonly string[];
  readonly insertedTransactions: number;
}

export async function refreshDemoWorkspace(
  db: NodePgDatabase<DrizzleSchema>,
  options: RefreshDemoWorkspaceOptions,
): Promise<RefreshDemoWorkspaceResult> {
  const now = options.now ?? new Date();
  const target: DemoWorkspaceTarget = {
    identityKey: options.identityKey,
    workspaceId: options.workspaceId,
    kind: "personal",
  };
  const months = demoWindowMonths(now);

  return db.transaction(async (tx) => {
    // Serialize concurrent refreshes of this demo identity across
    // processes (endpoint + CLI + replicas): released on commit/rollback.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${options.identityKey}, 0))`,
    );

    const { workspace, workspaceId, created } =
      await bootstrapDemoWorkspace(tx, target);

    // ── Wipe (S6): restore the seed state — every ledger/account/event
    // row a session touched goes away, not just data aged out of the
    // window. Same reset as `seedDemoWorkspaceInTransaction`.
    const purgedTransactions = await wipeDemoWorkspaceState(
      tx,
      workspace.id,
    );

    const categoryIdByKey = await demoCategoryIdByKey(tx, workspace.id);
    const { accountIdByKey, created: accountsCreated } =
      await ensureDemoAccounts(tx, workspaceId);

    // ── Re-seed: the deterministic plan filtered to the rolling window
    // (current, -1..-5) keeps the dataset inside the 6 months even when
    // the plan's 180-day horizon reaches into a seventh calendar month.
    const plan = buildDemoPlan(now, {
      months: months.map((month) => month.key),
    });
    const { counts } = await recordDemoTransactions(tx, {
      workspaceId,
      transactions: plan.transactions,
      accountIdByKey,
      categoryIdByKey,
    });
    // S6 (demo-seed-six-months T5): the refresh restores the full
    // seed state — the wiped closes come back with the re-seed, one
    // per oldest window month (-3..-5); the running month and the
    // two most recent stay open.
    await seedDemoPeriodCloses(tx, {
      workspaceId,
      months: months.slice(3),
      now,
    });
    const generatedMonths = months
      .filter((month) =>
        plan.transactions.some((transaction) =>
          transaction.businessDate.startsWith(month.key),
        ),
      )
      .map((month) => month.key);

    return {
      identityKey: options.identityKey,
      workspaceId: workspace.id,
      workspaceCreated: created,
      accountsCreated,
      purgedTransactions,
      generatedMonths,
      insertedTransactions:
        counts.income + counts.expense + counts.transfer,
    };
  });
}

/**
 * In-process serialization for the fire-and-forget refresh trigger
 * (demo-maria-session T3, S8): POST /api/v1/demo/refresh returns 202
 * immediately and kicks the maintenance through this coordinator — at
 * most one run per API instance (extra triggers while one is in flight
 * coalesce to a no-op), failures are logged and swallowed so they can
 * never crash the request, and the pg_advisory_xact_lock inside
 * {@link refreshDemoWorkspace} still serializes across processes.
 */
export class DemoRefreshTrigger {
  private running = false;

  constructor(
    private readonly run: (caller: CallerIdentity) => Promise<unknown>,
  ) {}

  trigger(caller: CallerIdentity): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void (async () => {
      try {
        await this.run(caller);
      } catch (error) {
        console.error("[api] demo refresh failed:", error);
      } finally {
        this.running = false;
      }
    })();
  }
}
