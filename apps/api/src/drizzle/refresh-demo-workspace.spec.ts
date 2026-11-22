import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte, lt } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "./db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactions,
  outboxEvents,
  notifications,
  workspaces,
} from "./schema.js";
import {
  DemoRefreshTrigger,
  refreshDemoWorkspace,
} from "./refresh-demo-workspace.js";
import type { CallerIdentity } from "../modules/identity-workspace/index.js";

/**
 * demo-maria-session T2 (S2/S3/S4): the shared single demo workspace is
 * maintained — never recreated — by `refreshDemoWorkspace`. On every run:
 * bootstrap if missing (workspace + PEN currency + the 12 catalog
 * categories + the 4 seed accounts), purge ledger transactions older
 * than the rolling 3-month window, and generate each window month ONLY
 * when it has no transactions (top-up, not wipe). The same routine backs
 * POST /api/v1/demo/refresh and `pnpm db:seed:demo:refresh`.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const IDENTITY_KEY = "demo-refresh-spec|maria";
const WORKSPACE_ID = "ws-demo-refresh-spec";
// Midday UTC keeps the America/Lima "today" identical to the UTC date.
const NOW = new Date("2026-03-15T12:00:00Z");
// Window months for NOW: current, -1, -2 (in that order).
const EXPECTED_MONTHS = ["2026-03", "2026-02", "2026-01"];
const WINDOW_START = "2026-01-01";

function refreshOptions() {
  return { identityKey: IDENTITY_KEY, workspaceId: WORKSPACE_ID, now: NOW };
}

/**
 * Recording demo transactions writes pending outbox rows (transactional
 * outbox) — delete them right after each refresh so this spec does not
 * leak pending events into the shared dev DB while the parallel
 * drain-outbox suite samples the global pending count.
 */
async function refresh(db: Parameters<typeof refreshDemoWorkspace>[0]) {
  const result = await refreshDemoWorkspace(db, refreshOptions());
  await db
    .delete(outboxEvents)
    .where(eq(outboxEvents.workspaceId, WORKSPACE_ID));
  return result;
}

async function cleanup(db: DrizzleDb): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.identityKey, IDENTITY_KEY));
  const ids = owned.map((w) => w.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    // Splits and revisions cascade on the transaction FK.
    await db
      .delete(ledgerTransactions)
      .where(eq(ledgerTransactions.workspaceId, id));
    await db.delete(accounts).where(eq(accounts.workspaceId, id));
    await db.delete(outboxEvents).where(eq(outboxEvents.workspaceId, id));
    await db
      .delete(notifications)
      .where(eq(notifications.workspaceId, id));
    await db.delete(categories).where(eq(categories.workspaceId, id));
    await db.delete(currencies).where(eq(currencies.workspaceId, id));
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
}

function monthRange(month: string): { from: Date; to: Date } {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, mon - 1, 1)),
    to: new Date(Date.UTC(year, mon, 1)),
  };
}

async function transactionRows(
  db: DrizzleDb,
  workspaceId: string,
  month?: string,
) {
  const conditions = [eq(ledgerTransactions.workspaceId, workspaceId)];
  if (month !== undefined) {
    const { from, to } = monthRange(month);
    conditions.push(
      gte(ledgerTransactions.businessDate, from),
      lt(ledgerTransactions.businessDate, to),
    );
  }
  return db
    .select({
      id: ledgerTransactions.id,
      idempotencyKey: ledgerTransactions.idempotencyKey,
      businessDate: ledgerTransactions.businessDate,
    })
    .from(ledgerTransactions)
    .where(and(...conditions));
}

describe("refreshDemoWorkspace (integration, real Postgres — T2)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);

  beforeEach(async () => {
    await cleanup(db);
  });

  afterAll(async () => {
    await cleanup(db);
    await pool.end();
  });

  it("bootstraps a missing workspace (currency + 12 categories + 4 accounts) and generates all 3 window months (S2/S3)", async () => {
    const result = await refresh(db);

    expect(result.workspaceCreated).toBe(true);
    expect(result.generatedMonths).toEqual(EXPECTED_MONTHS);
    expect(result.insertedTransactions).toBeGreaterThan(0);
    expect(result.purgedTransactions).toBe(0);

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, IDENTITY_KEY))
      .limit(1);
    expect(workspace).toBeDefined();
    expect(workspace!.kind).toBe("personal");
    expect(workspace!.timezone).toBe("America/Lima");
    expect(workspace!.defaultCurrency).toBe("PEN");

    const currencyRows = await db
      .select()
      .from(currencies)
      .where(eq(currencies.workspaceId, workspace!.id));
    expect(currencyRows).toHaveLength(1);
    expect(currencyRows[0]!.code).toBe("PEN");

    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, workspace!.id));
    expect(categoryRows).toHaveLength(12);

    const accountRows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.workspaceId, workspace!.id));
    expect(accountRows).toHaveLength(4);

    for (const month of EXPECTED_MONTHS) {
      const rows = await transactionRows(db, workspace!.id, month);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("is a no-op when every window month already has data — existing months stay untouched (S3)", async () => {
    await refresh(db);
    const before = await transactionRows(db, WORKSPACE_ID);

    const again = await refresh(db);

    expect(again.workspaceCreated).toBe(false);
    expect(again.generatedMonths).toEqual([]);
    expect(again.insertedTransactions).toBe(0);
    expect(again.purgedTransactions).toBe(0);
    const after = await transactionRows(db, WORKSPACE_ID);
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });

  it("top-ups ONLY the missing month and leaves the existing ones untouched (S3)", async () => {
    const first = await refresh(db);
    const workspaceId = first.workspaceId;
    const month = EXPECTED_MONTHS[1]!; // 2026-02 (month -1)
    const untouchedMonths = [EXPECTED_MONTHS[0]!, EXPECTED_MONTHS[2]!];

    const originalKeys = (
      await transactionRows(db, workspaceId, month)
    ).map((row) => row.idempotencyKey);
    const untouchedIds = new Map<string, string[]>();
    for (const kept of untouchedMonths) {
      untouchedIds.set(
        kept,
        (await transactionRows(db, workspaceId, kept)).map((row) => row.id),
      );
    }

    // Simulate a demo month that lost its data.
    const doomed = await transactionRows(db, workspaceId, month);
    await db
      .delete(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, workspaceId),
          gte(
            ledgerTransactions.businessDate,
            monthRange(month).from,
          ),
          lt(ledgerTransactions.businessDate, monthRange(month).to),
        ),
      );
    expect(doomed.length).toBeGreaterThan(0);

    const again = await refresh(db);

    expect(again.generatedMonths).toEqual([month]);
    // The regenerated month carries the exact plan rows (deterministic keys).
    const regeneratedKeys = (
      await transactionRows(db, workspaceId, month)
    ).map((row) => row.idempotencyKey);
    expect(regeneratedKeys.sort()).toEqual(originalKeys.sort());
    // The other months were never touched — same transaction ids.
    for (const kept of untouchedMonths) {
      const ids = (await transactionRows(db, workspaceId, kept)).map(
        (row) => row.id,
      );
      expect(ids.sort()).toEqual(untouchedIds.get(kept)!.sort());
    }
  });

  it("purges ledger transactions older than the 3-month window (S3)", async () => {
    await refresh(db);
    await db.insert(ledgerTransactions).values([
      {
        id: "demo-refresh-stale-1",
        workspaceId: WORKSPACE_ID,
        idempotencyKey: "demo-refresh-stale-1",
        type: "expense",
        amountMinor: 1_000n,
        currency: "PEN",
        businessDate: new Date("2025-12-31T00:00:00Z"),
        timezone: "America/Lima",
        concept: "Stale diciembre",
        status: "confirmed",
        origin: "manual",
        confirmedAt: new Date("2025-12-31T00:00:00Z"),
        confirmedBy: "demo-refresh-spec",
      },
      {
        id: "demo-refresh-stale-2",
        workspaceId: WORKSPACE_ID,
        idempotencyKey: "demo-refresh-stale-2",
        type: "income",
        amountMinor: 5_000n,
        currency: "PEN",
        businessDate: new Date("2025-10-05T00:00:00Z"),
        timezone: "America/Lima",
        concept: "Stale octubre",
        status: "confirmed",
        origin: "manual",
        confirmedAt: new Date("2025-10-05T00:00:00Z"),
        confirmedBy: "demo-refresh-spec",
      },
    ]);

    const result = await refresh(db);

    expect(result.purgedTransactions).toBe(2);
    expect(result.generatedMonths).toEqual([]);
    const remaining = await transactionRows(db, WORKSPACE_ID);
    expect(remaining.every((row) => row.id !== "demo-refresh-stale-1")).toBe(
      true,
    );
    expect(remaining.every((row) => row.id !== "demo-refresh-stale-2")).toBe(
      true,
    );
    // Everything left sits inside the window.
    const cutoff = new Date(`${WINDOW_START}T00:00:00Z`);
    expect(
      remaining.every((row) => row.businessDate.getTime() >= cutoff.getTime()),
    ).toBe(true);
  });
});

/**
 * demo-maria-session T3 (S8): the endpoint kicks the maintenance
 * fire-and-forget — the trigger coalesces concurrent requests while one
 * refresh is in flight, logs failures, and never lets a rejected run
 * wedge the mutex or crash the request path.
 */
describe("DemoRefreshTrigger (T3)", () => {
  const CALLER: CallerIdentity = { issuer: "local", subject: "demo-maria" };

  it("coalesces concurrent triggers into a single run and re-arms after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi
      .fn<(caller: CallerIdentity) => Promise<unknown>>()
      .mockReturnValueOnce(gate)
      .mockResolvedValue(undefined);
    const trigger = new DemoRefreshTrigger(run);

    trigger.trigger(CALLER);
    trigger.trigger(CALLER);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(CALLER);

    release();
    await gate;
    // The mutex releases on the run's microtask tail — retry until the
    // next trigger actually starts a second run.
    await vi.waitFor(() => {
      trigger.trigger(CALLER);
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  it("logs a failing run, swallows it, and releases the mutex", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const run = vi
        .fn<(caller: CallerIdentity) => Promise<unknown>>()
        .mockRejectedValueOnce(new Error("db down"))
        .mockResolvedValue(undefined);
      const trigger = new DemoRefreshTrigger(run);

      trigger.trigger(CALLER);
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalled();
      });

      trigger.trigger(CALLER);
      await vi.waitFor(() => {
        expect(run).toHaveBeenCalledTimes(2);
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
