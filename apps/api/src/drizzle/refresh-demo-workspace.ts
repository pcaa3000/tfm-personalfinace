import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleSchema } from "./db.js";
import {
  ledgerTransactionRevisions,
  ledgerTransactions,
  ledgerTransactionSplits,
} from "./schema.js";
import { buildDemoPlan, demoWindowMonths } from "./seed-demo-data.js";
import {
  bootstrapDemoWorkspace,
  demoCategoryIdByKey,
  ensureDemoAccounts,
  recordDemoTransactions,
  type DemoWorkspaceTarget,
} from "./seed-demo-workspace.js";
import type { CallerIdentity } from "../modules/identity-workspace/index.js";

/**
 * Rolling 3-month maintenance for the shared "María" demo workspace
 * (odd/tasks/demo-maria-session T2, S2/S3/S4): the demo subject keeps ONE
 * workspace `<issuer>|<demo-sub>` — `oidc: <OIDC_ISSUER>|<demo-uid>`,
 * `dev: local|demo-maria` — and every demo sign-in plus the
 * `pnpm db:seed:demo:refresh` script run this routine:
 *
 * 1. Bootstrap — if the workspace does not exist yet, create it with the
 *    PEN currency, the 12 workspace category copies and the four seed
 *    accounts (same building blocks as `seedDemoWorkspace`).
 * 2. Purge — delete ledger transactions older than the window
 *    (current month, -1, -2), splits and revisions first.
 * 3. Top-up — for each window month with NO transactions, generate that
 *    month's slice of the deterministic plan through
 *    RecordManualTransactionUseCase. Months that already hold data —
 *    seeded or user-entered — are never touched (no wipe, S6's
 *    simplified model: session changes survive until data ages out or
 *    the dev-only /demo/reset runs).
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
  readonly purgedTransactions: number;
  /** "YYYY-MM" keys (current, -1, -2 order) that were generated. */
  readonly generatedMonths: readonly string[];
  readonly insertedTransactions: number;
}

function dateAtStartOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
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
  const cutoff = new Date(
    `${months[months.length - 1]!.start}T00:00:00Z`,
  );

  return db.transaction(async (tx) => {
    // Serialize concurrent refreshes of this demo identity across
    // processes (endpoint + CLI + replicas): released on commit/rollback.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${options.identityKey}, 0))`,
    );

    const { workspace, workspaceId, created } =
      await bootstrapDemoWorkspace(tx, target);
    const categoryIdByKey = await demoCategoryIdByKey(tx, workspace.id);
    const { accountIdByKey, created: accountsCreated } =
      await ensureDemoAccounts(tx, workspaceId);

    // ── Purge: ledger rows older than the 3-month window. Splits and
    // revisions go first (FK children) — the transactions themselves
    // carry the (workspaceId, businessDate) index for this scan.
    const stale = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, workspace.id),
          lt(ledgerTransactions.businessDate, cutoff),
        ),
      );
    if (stale.length > 0) {
      const staleIds = stale.map((row) => row.id);
      await tx
        .delete(ledgerTransactionSplits)
        .where(inArray(ledgerTransactionSplits.transactionId, staleIds));
      await tx
        .delete(ledgerTransactionRevisions)
        .where(
          inArray(ledgerTransactionRevisions.transactionId, staleIds),
        );
      await tx
        .delete(ledgerTransactions)
        .where(inArray(ledgerTransactions.id, staleIds));
    }

    // ── Top-up: generate each empty window month; never wipe a month
    // that already has data.
    const generatedMonths: string[] = [];
    let insertedTransactions = 0;
    for (const month of months) {
      const hasData = await tx
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.workspaceId, workspace.id),
            gte(ledgerTransactions.businessDate, dateAtStartOfDay(month.start)),
            lt(ledgerTransactions.businessDate, dateAtStartOfDay(month.end)),
          ),
        )
        .limit(1);
      if (hasData.length > 0) {
        continue;
      }
      const plan = buildDemoPlan(now, { months: [month.key] });
      if (plan.transactions.length === 0) {
        continue;
      }
      const { counts } = await recordDemoTransactions(tx, {
        workspaceId,
        transactions: plan.transactions,
        accountIdByKey,
        categoryIdByKey,
      });
      generatedMonths.push(month.key);
      insertedTransactions +=
        counts.income + counts.expense + counts.transfer;
    }

    return {
      identityKey: options.identityKey,
      workspaceId: workspace.id,
      workspaceCreated: created,
      accountsCreated,
      purgedTransactions: stale.length,
      generatedMonths,
      insertedTransactions,
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
