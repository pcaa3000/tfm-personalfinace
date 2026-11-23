import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DrizzleSchema } from "../../../drizzle/db.js";
import {
  ledgerTransactions,
  workspaces,
} from "../../../drizzle/schema.js";
import {
  cleanupDemoWorkspaces,
  cleanupDemoWorkspacesInTransaction,
  deleteWorkspacesCascade,
  DEMO_WORKSPACE_KIND,
  demoOrphanCutoff,
  demoSessionAdvisoryLock,
  DemoSessionSeedTrigger,
  seedDemoSessionWorkspace,
} from "../../../drizzle/demo-session-workspaces.js";
import {
  DEMO_CURRENCY,
  DEMO_TIMEZONE,
} from "../../../drizzle/seed-demo-data.js";
import type { CallerIdentity } from "../../identity-workspace/index.js";
import type {
  DemoSession,
  DemoSessionPort,
  DemoSessionStatus,
} from "../application/demo-session.port.js";

/**
 * Postgres-backed {@link DemoSessionPort} (demo-maria-session T6 —
 * L10 final model, async variant of the L3 service).
 *
 * `createSession` mints the sid, inserts the bare `issuer|subject|sid`
 * kind='demo' workspace row SYNCHRONOUSLY — so the fail-closed
 * resolver accepts the new sid the moment POST /demo/session answers —
 * then kicks the seeding fire-and-forget through a per-sid in-process
 * mutex ({@link DemoSessionSeedTrigger}): bootstrap + months
 * current/-1..-5 in order, and finally the >24h orphan sweep, each
 * piece behind a pg advisory lock per sid. A failed job is logged and
 * swallowed; the leftover workspace is collected by the next sweep.
 *
 * `endSession` deletes that session's workspace with all its data
 * (cascade-safe order) and runs the same >24h orphan sweep — both in
 * ONE transaction, and idempotent: an unknown sid simply sweeps and
 * resolves, so logout is always a clean 204. The transaction first
 * takes the SAME per-sid `pg_advisory_xact_lock` the seed job uses
 * (R1-001): a DELETE concurrent with seeding waits for the current
 * seed step instead of colliding on FK RESTRICT, and the next seed
 * step then sees the workspace gone and aborts.
 */
export class DrizzleDemoSessionService implements DemoSessionPort {
  private readonly seeder: DemoSessionSeedTrigger;

  constructor(private readonly db: NodePgDatabase<DrizzleSchema>) {
    this.seeder = new DemoSessionSeedTrigger(async (target) => {
      const seeded = await seedDemoSessionWorkspace(db, target);
      const swept = await cleanupDemoWorkspaces(db, {
        olderThan: demoOrphanCutoff(),
      });
      console.log(
        `[api] demo session ${target.identityKey}: ` +
          (seeded.aborted
            ? "seed aborted — session workspace already removed; "
            : `seeded ${seeded.insertedTransactions} transactions ` +
              `across ${seeded.generatedMonths.join(", ") || "no months"}; `) +
          `swept ${swept.deletedWorkspaceIds.length} orphan workspaces`,
      );
    });
  }

  async createSession(caller: CallerIdentity): Promise<DemoSession> {
    const sessionId = randomUUID();
    const identityKey = `${caller.issuer}|${caller.subject}|${sessionId}`;
    const workspaceId = `ws-demo-${sessionId}`;
    // The row must exist BEFORE the response: the fail-closed resolver
    // accepts the new sid immediately while the dataset is still
    // being generated in the background (S8).
    await this.db.insert(workspaces).values({
      id: workspaceId,
      identityKey,
      kind: DEMO_WORKSPACE_KIND,
      timezone: DEMO_TIMEZONE,
      defaultCurrency: DEMO_CURRENCY,
    });
    this.seeder.trigger({ identityKey, workspaceId });
    return { sessionId, workspaceId };
  }

  async endSession(
    caller: CallerIdentity,
    sessionId: string,
  ): Promise<void> {
    const identityKey = `${caller.issuer}|${caller.subject}|${sessionId}`;
    await this.db.transaction(async (tx) => {
      // R1-001: serialize with the in-flight seed for this sid — it
      // takes the same advisory lock for every step, so this delete
      // never races a concurrent bootstrap/month insert.
      await tx.execute(demoSessionAdvisoryLock(identityKey));
      const [session] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.identityKey, identityKey),
            eq(workspaces.kind, DEMO_WORKSPACE_KIND),
          ),
        )
        .limit(1);
      if (session) {
        await deleteWorkspacesCascade(tx, [session.id]);
      }
      // Same >24h orphan sweep the async seed job and the CLI run
      // (L10: logout also depura los workspaces huérfanos).
      await cleanupDemoWorkspacesInTransaction(tx, {
        olderThan: demoOrphanCutoff(),
      });
    });
  }

  async sessionStatus(
    caller: CallerIdentity,
    sessionId: string,
  ): Promise<DemoSessionStatus> {
    // T9 (S10): readiness is a DB fact, not job memory — the seed
    // inserts months oldest-visible first, so "has transactions" is
    // the exact moment the demo stops looking empty.
    const identityKey = `${caller.issuer}|${caller.subject}|${sessionId}`;
    const [workspace] = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.identityKey, identityKey),
          eq(workspaces.kind, DEMO_WORKSPACE_KIND),
        ),
      )
      .limit(1);
    if (!workspace) return { ready: false };
    const [row] = await this.db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.workspaceId, workspace.id))
      .limit(1);
    return { ready: row !== undefined };
  }

  /**
   * Spec/ops seam: resolves once every in-flight seed job settles —
   * integration specs await the async seeding without sleeping.
   */
  async idle(): Promise<void> {
    await this.seeder.idle();
  }
}
