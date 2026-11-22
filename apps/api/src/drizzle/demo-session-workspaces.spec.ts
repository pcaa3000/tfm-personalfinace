import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte, inArray, lt } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "./db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactions,
  notifications,
  outboxEvents,
  receiptScans,
  workspaces,
} from "./schema.js";
import {
  cleanupDemoWorkspaces,
  deleteWorkspacesCascade,
  DEMO_ORPHAN_MAX_AGE_MS,
  demoOrphanCutoff,
  DemoSessionSeedTrigger,
  seedDemoSessionWorkspace,
  type SeedDemoSessionWorkspaceResult,
} from "./demo-session-workspaces.js";

/**
 * demo-maria-session T6+T7 (L10, modelo por-sid restaurado): per-session
 * ephemeral demo workspaces of kind='demo' (`issuer|subject|sid`) are
 * seeded async month by month — current, -1, -2 in that order — and
 * orphaned ones (createdAt < now-24h) are removed with all their data
 * by `cleanupDemoWorkspaces`, the routine shared by the async seed
 * job, DELETE /api/v1/demo/session and `pnpm db:demo:cleanup`.
 * Integration spec against the real Postgres so the advisory locks and
 * the cascade-safe delete order run for real.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const ISSUER = "demo-session-ws-spec";
// Midday UTC keeps the America/Lima "today" identical to the UTC date.
const NOW = new Date("2026-03-15T12:00:00Z");
// Window months for NOW in generation order: current, -1, -2.
const EXPECTED_MONTHS = ["2026-03", "2026-02", "2026-01"];

async function cleanupSpecWorkspaces(db: DrizzleDb): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      inArray(workspaces.identityKey, [
        `${ISSUER}|maria|sid-seed`,
        `${ISSUER}|maria|sid-orphan`,
        `${ISSUER}|maria|sid-fresh`,
        `${ISSUER}|maria|pinned`,
      ]),
    );
  const ids = owned.map((row) => row.id);
  if (ids.length === 0) return;
  await deleteWorkspacesCascade(db, ids);
}

/**
 * Recording demo transactions writes pending outbox rows
 * (transactional outbox) — delete them right after each seed so this
 * spec does not leak pending events into the shared dev DB while the
 * parallel drain-outbox suite samples the global pending count (same
 * hygiene as refresh-demo-workspace.spec).
 */
async function seedSessionWorkspace(
  db: Parameters<typeof seedDemoSessionWorkspace>[0],
  options: Parameters<typeof seedDemoSessionWorkspace>[1],
): Promise<SeedDemoSessionWorkspaceResult> {
  const result = await seedDemoSessionWorkspace(db, options);
  await db
    .delete(outboxEvents)
    .where(eq(outboxEvents.workspaceId, result.workspaceId));
  return result;
}

function monthRange(month: string): { from: Date; to: Date } {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, mon - 1, 1)),
    to: new Date(Date.UTC(year, mon, 1)),
  };
}

async function transactionCount(
  db: DrizzleDb,
  workspaceId: string,
  month?: string,
): Promise<number> {
  const conditions = [eq(ledgerTransactions.workspaceId, workspaceId)];
  if (month !== undefined) {
    const { from, to } = monthRange(month);
    conditions.push(
      gte(ledgerTransactions.businessDate, from),
      lt(ledgerTransactions.businessDate, to),
    );
  }
  const rows = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(and(...conditions));
  return rows.length;
}

describe("seedDemoSessionWorkspace (integration, real Postgres — T6)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const IDENTITY_KEY = `${ISSUER}|maria|sid-seed`;
  const WORKSPACE_ID = "ws-demo-session-seed-spec";

  beforeEach(async () => {
    await cleanupSpecWorkspaces(db);
  });

  afterAll(async () => {
    await cleanupSpecWorkspaces(db);
    await pool.end();
  });

  it("seeds a kind='demo' workspace month by month in window order: current, -1, -2 (S3)", async () => {
    const result = await seedSessionWorkspace(db, {
      identityKey: IDENTITY_KEY,
      workspaceId: WORKSPACE_ID,
      now: NOW,
    });

    // Generation order is observable: months are produced one at a
    // time in the spec's exact order.
    expect(result.generatedMonths).toEqual(EXPECTED_MONTHS);
    expect(result.insertedTransactions).toBeGreaterThan(0);

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, IDENTITY_KEY));
    expect(workspace).toBeDefined();
    expect(workspace!.id).toBe(WORKSPACE_ID);
    expect(workspace!.kind).toBe("demo");
    expect(workspace!.defaultCurrency).toBe("PEN");

    const accountRows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.workspaceId, workspace!.id));
    expect(accountRows).toHaveLength(4);
    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, workspace!.id));
    expect(categoryRows).toHaveLength(12);
    const currencyRows = await db
      .select()
      .from(currencies)
      .where(eq(currencies.workspaceId, workspace!.id));
    expect(currencyRows).toHaveLength(1);

    for (const month of EXPECTED_MONTHS) {
      expect(await transactionCount(db, workspace!.id, month)).toBeGreaterThan(
        0,
      );
    }
  });

  it("adopts a pre-created empty workspace row (the row POST /demo/session inserts) and is re-runnable", async () => {
    // POST /demo/session inserts the bare row before the async seed.
    await db.insert(workspaces).values({
      id: WORKSPACE_ID,
      identityKey: IDENTITY_KEY,
      kind: "demo",
      timezone: "America/Lima",
      defaultCurrency: "PEN",
    });

    const first = await seedSessionWorkspace(db, {
      identityKey: IDENTITY_KEY,
      workspaceId: WORKSPACE_ID,
      now: NOW,
    });
    expect(first.workspaceCreated).toBe(false);
    expect(first.generatedMonths).toEqual(EXPECTED_MONTHS);

    const second = await seedSessionWorkspace(db, {
      identityKey: IDENTITY_KEY,
      workspaceId: WORKSPACE_ID,
      now: NOW,
    });
    expect(second.generatedMonths).toEqual(EXPECTED_MONTHS);
    expect(second.insertedTransactions).toBe(first.insertedTransactions);
    expect(await transactionCount(db, WORKSPACE_ID)).toBe(
      first.insertedTransactions,
    );
  });
});

describe("cleanupDemoWorkspaces (integration, real Postgres — T6/T7)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);

  beforeEach(async () => {
    await cleanupSpecWorkspaces(db);
  });

  afterAll(async () => {
    await cleanupSpecWorkspaces(db);
    await pool.end();
  });

  /** Minimal workspace-scoped rows proving the cascade wipes data. */
  async function seedWorkspaceData(workspaceId: string): Promise<void> {
    await db.insert(currencies).values({
      id: `cur-${workspaceId}`,
      workspaceId,
      code: "PEN",
    });
    await db.insert(categories).values({
      id: `cat-${workspaceId}`,
      key: "food",
      label: "Comida",
      nature: "essential",
      workspaceId,
    });
    await db.insert(accounts).values({
      id: `acc-${workspaceId}`,
      workspaceId,
      name: "Banco",
      currency: "PEN",
      kind: "bank",
    });
    await db.insert(outboxEvents).values({
      id: `out-${workspaceId}`,
      workspaceId,
      type: "demo",
      payload: {},
    });
    await db.insert(notifications).values({
      id: `ntf-${workspaceId}`,
      workspaceId,
      kind: "demo",
      title: "t",
      body: "b",
    });
    await db.insert(receiptScans).values({
      id: `scan-${workspaceId}`,
      workspaceId,
      uploaderSubject: "maria",
      storageKey: `k-${workspaceId}`,
      originalFilename: "f.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }

  async function workspaceExists(id: string): Promise<boolean> {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, id));
    return row !== undefined;
  }

  async function countChildRows(
    db: DrizzleDb,
    workspaceId: string,
  ): Promise<Record<string, number>> {
    const count = async (
      query: Promise<{ id: string }[]>,
    ): Promise<number> => (await query).length;
    return {
      currencies: await count(
        db
          .select({ id: currencies.id })
          .from(currencies)
          .where(eq(currencies.workspaceId, workspaceId)),
      ),
      categories: await count(
        db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.workspaceId, workspaceId)),
      ),
      accounts: await count(
        db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.workspaceId, workspaceId)),
      ),
      outboxEvents: await count(
        db
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(eq(outboxEvents.workspaceId, workspaceId)),
      ),
      notifications: await count(
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.workspaceId, workspaceId)),
      ),
      receiptScans: await count(
        db
          .select({ id: receiptScans.id })
          .from(receiptScans)
          .where(eq(receiptScans.workspaceId, workspaceId)),
      ),
    };
  }

  it("deletes kind='demo' workspaces older than 24h WITH their data; keeps fresh demo and old non-demo rows (L10)", async () => {
    const cutoff = demoOrphanCutoff(); // now - 24h
    const stale = new Date(Date.now() - 2 * DEMO_ORPHAN_MAX_AGE_MS);

    await db.insert(workspaces).values([
      {
        id: "ws-cleanup-orphan",
        identityKey: `${ISSUER}|maria|sid-orphan`,
        kind: "demo",
        timezone: "America/Lima",
        defaultCurrency: "PEN",
      },
      {
        id: "ws-cleanup-fresh",
        identityKey: `${ISSUER}|maria|sid-fresh`,
        kind: "demo",
        timezone: "America/Lima",
        defaultCurrency: "PEN",
      },
      {
        id: "ws-cleanup-personal",
        identityKey: `${ISSUER}|maria|pinned`,
        kind: "personal",
        timezone: "America/Lima",
        defaultCurrency: "PEN",
      },
    ]);
    // Backdate the orphan and the non-demo row beyond the cutoff.
    await db
      .update(workspaces)
      .set({ createdAt: stale })
      .where(
        inArray(workspaces.id, ["ws-cleanup-orphan", "ws-cleanup-personal"]),
      );
    await seedWorkspaceData("ws-cleanup-orphan");

    const result = await cleanupDemoWorkspaces(db, { olderThan: cutoff });

    expect(result.deletedWorkspaceIds).toEqual(["ws-cleanup-orphan"]);
    // Orphan row AND every scoped child row are gone.
    expect(await workspaceExists("ws-cleanup-orphan")).toBe(false);
    const orphanChildren = await countChildRows(db, "ws-cleanup-orphan");
    expect(orphanChildren).toEqual({
      currencies: 0,
      categories: 0,
      accounts: 0,
      outboxEvents: 0,
      notifications: 0,
      receiptScans: 0,
    });
    // Fresh demo and old non-demo workspaces are untouched.
    expect(await workspaceExists("ws-cleanup-fresh")).toBe(true);
    expect(await workspaceExists("ws-cleanup-personal")).toBe(true);
  });

  it("is a no-op when nothing is older than the cutoff", async () => {
    await db.insert(workspaces).values({
      id: "ws-cleanup-fresh",
      identityKey: `${ISSUER}|maria|sid-fresh`,
      kind: "demo",
      timezone: "America/Lima",
      defaultCurrency: "PEN",
    });

    const result = await cleanupDemoWorkspaces(db, {
      olderThan: demoOrphanCutoff(),
    });

    expect(result.deletedWorkspaceIds).toEqual([]);
    expect(await workspaceExists("ws-cleanup-fresh")).toBe(true);
  });
});

/**
 * demo-maria-session T6 (S8): the endpoint kicks the seed
 * fire-and-forget — the per-sid trigger coalesces concurrent kicks for
 * the same session workspace while letting different sids run, logs
 * failures, and never lets a rejected run wedge the mutex.
 */
describe("DemoSessionSeedTrigger (T6)", () => {
  const TARGET = { identityKey: "local|maria|sid-1", workspaceId: "ws-1" };

  it("coalesces concurrent triggers for the same sid and re-arms after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn<(target: { identityKey: string }) => Promise<unknown>>()
      .mockReturnValueOnce(gate)
      .mockResolvedValue(undefined);
    const trigger = new DemoSessionSeedTrigger(run);

    trigger.trigger(TARGET);
    trigger.trigger(TARGET);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(TARGET);

    release();
    await gate;
    await trigger.idle();
    trigger.trigger(TARGET);
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(2);
    });
    await trigger.idle();
  });

  it("lets different sids run concurrently", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn<(target: { identityKey: string }) => Promise<unknown>>()
      .mockReturnValue(gate);
    const trigger = new DemoSessionSeedTrigger(run);

    trigger.trigger(TARGET);
    trigger.trigger({ identityKey: "local|maria|sid-2", workspaceId: "ws-2" });

    expect(run).toHaveBeenCalledTimes(2);

    release();
    await trigger.idle();
  });

  it("logs a failing run, swallows it, and releases the slot", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const run = vi
        .fn<(target: { identityKey: string }) => Promise<unknown>>()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValue(undefined);
      const trigger = new DemoSessionSeedTrigger(run);

      trigger.trigger(TARGET);
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalled();
      });
      await trigger.idle();

      trigger.trigger(TARGET);
      await vi.waitFor(() => {
        expect(run).toHaveBeenCalledTimes(2);
      });
      await trigger.idle();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
