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
  periodCloses,
  receiptScans,
  voiceConsents,
  voiceNotes,
  workspaces,
} from "./schema.js";
import { demoWindowMonths } from "./seed-demo-data.js";
import {
  DemoRefreshTrigger,
  refreshDemoWorkspace,
} from "./refresh-demo-workspace.js";
import type { CallerIdentity } from "../modules/identity-workspace/index.js";
import { DrizzlePeriodCloseRepository } from "../modules/reports/infrastructure/drizzle-period-close.repository.js";
import { WorkspaceId } from "../modules/shared-kernel/index.js";

/**
 * demo-maria-session T2 (S2/S3/S4) + S6: the shared single demo
 * workspace is RESTORED — never topped up — by `refreshDemoWorkspace`.
 * On every run: bootstrap if missing (workspace + PEN currency + the
 * catalog categories + the 4 seed accounts), wipe the workspace's
 * ledger/accounts/outbox/notifications exactly like
 * `seedDemoWorkspaceInTransaction`'s reset, then re-seed the rolling
 * 6-month window through the deterministic plan. A visitor's writes
 * inside a session are discarded by the NEXT refresh (S6). The same
 * routine backs POST /api/v1/demo/refresh and
 * `pnpm db:seed:demo:refresh`.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const IDENTITY_KEY = "demo-refresh-spec|maria";
const WORKSPACE_ID = "ws-demo-refresh-spec";
// Midday UTC keeps the America/Lima "today" identical to the UTC date.
const NOW = new Date("2026-03-15T12:00:00Z");
// Window months for NOW — derived from `demoWindowMonths` so the
// expectations track the shared rolling window (current first).
const EXPECTED_MONTHS = demoWindowMonths(NOW).map((month) => month.key);

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
    await db.delete(voiceNotes).where(eq(voiceNotes.workspaceId, id));
    await db
      .delete(voiceConsents)
      .where(eq(voiceConsents.workspaceId, id));
    await db.delete(periodCloses).where(eq(periodCloses.workspaceId, id));
    await db.delete(receiptScans).where(eq(receiptScans.workspaceId, id));
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

/** Last calendar day of a "YYYY-MM" month as YYYY-MM-DD. */
function monthLastDay(month: string): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

function workspaceIdOrThrow(value: string): WorkspaceId {
  const created = WorkspaceId.create(value);
  if (!created.ok) throw created.error;
  return created.value;
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

  it("bootstraps a missing workspace (currency + catalog categories + 4 accounts) and generates all 6 window months (S2/S3)", async () => {
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
    // 12 global catalog copies + 2 demo-only discretionary categories
    // (reports-monthly T11: minor_transport, subscriptions).
    expect(categoryRows).toHaveLength(14);

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

  it("restores the seed state — a visitor's in-window writes, a stale row and a deleted seed row are all discarded/re-seeded (S6)", async () => {
    await refresh(db);
    const baselineKeys = (await transactionRows(db, WORKSPACE_ID)).map(
      (row) => row.idempotencyKey,
    );

    // A demo session's writes inside the window…
    await db.insert(ledgerTransactions).values([
      {
        id: "demo-refresh-visitor-1",
        workspaceId: WORKSPACE_ID,
        idempotencyKey: "demo-refresh-visitor-1",
        type: "expense",
        amountMinor: 1_500n,
        currency: "PEN",
        businessDate: new Date("2026-02-10T00:00:00Z"),
        timezone: "America/Lima",
        concept: "Gasto de visita",
        status: "confirmed",
        origin: "manual",
        confirmedAt: new Date("2026-02-10T00:00:00Z"),
        confirmedBy: "demo-refresh-spec",
      },
      {
        // …and one left outside the window.
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
    ]);
    // …plus the deletion of a seed row (splits/revisions cascade).
    const [doomed] = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, WORKSPACE_ID),
          eq(ledgerTransactions.idempotencyKey, baselineKeys[0]!),
        ),
      )
      .limit(1);
    await db
      .delete(ledgerTransactions)
      .where(eq(ledgerTransactions.id, doomed!.id));

    const again = await refresh(db);

    expect(again.workspaceCreated).toBe(false);
    // Wiped: baseline − 1 deleted + visitor + stale = baseline + 1.
    expect(again.purgedTransactions).toBe(baselineKeys.length + 1);
    expect(again.generatedMonths).toEqual(EXPECTED_MONTHS);
    const after = await transactionRows(db, WORKSPACE_ID);
    const afterKeys = after.map((row) => row.idempotencyKey).sort();
    // Seed state restored exactly: the deleted seed row is back and the
    // session's rows are gone.
    expect(afterKeys).toEqual([...baselineKeys].sort());
    expect(after.every((row) => row.id !== "demo-refresh-visitor-1")).toBe(
      true,
    );
    expect(after.every((row) => row.id !== "demo-refresh-stale-1")).toBe(true);
  });

  // demo-seed-six-months T2 (S4): the wipe is re-seed semantics — it
  // keeps running on a pre-existing workspace, and a freshly
  // bootstrapped one still seeds fully (skip is a no-op).
  it("a fresh workspace seeds fully and a re-run still wipes prior state", async () => {
    const first = await refresh(db);
    expect(first.workspaceCreated).toBe(true);
    expect(first.insertedTransactions).toBeGreaterThan(0);
    expect(first.purgedTransactions).toBe(0);

    const again = await refresh(db);
    expect(again.workspaceCreated).toBe(false);
    expect(again.purgedTransactions).toBe(first.insertedTransactions);
    expect(again.generatedMonths).toEqual(EXPECTED_MONTHS);
    // And the re-seeded dataset is exactly the deterministic window
    // plan — no duplicates survived the wipe.
    const rows = await transactionRows(db, WORKSPACE_ID);
    expect(rows.length).toBe(again.insertedTransactions);
  });

  it("purges outbox events and notifications left behind by previous runs (S6)", async () => {
    await refresh(db);
    await db.insert(outboxEvents).values({
      id: "demo-refresh-orphan-outbox",
      workspaceId: WORKSPACE_ID,
      type: "demo.orphan",
      payload: { orphan: true },
    });
    await db.insert(notifications).values({
      id: "demo-refresh-orphan-notification",
      workspaceId: WORKSPACE_ID,
      kind: "demo_orphan",
      title: "orphan",
      body: "leftover",
    });

    // Call the routine directly (not the spec helper) so the wipe itself
    // is observed — the helper's outbox cleanup would hide a miss.
    const result = await refreshDemoWorkspace(db, refreshOptions());

    expect(result.workspaceCreated).toBe(false);
    const orphan = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, "demo-refresh-orphan-outbox"));
    expect(orphan).toHaveLength(0);
    const leftover = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.workspaceId, WORKSPACE_ID));
    expect(leftover).toHaveLength(0);
    // Hygiene: drop the pending outbox rows the re-seed just wrote.
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.workspaceId, WORKSPACE_ID));
  });

  // demo-seed-six-months T4 (S5): the wipe must also clear the
  // workspace-scoped rows that carry a plain-text workspaceId with no
  // FK — today voice notes, voice consents and period closes leak.
  it("the reset wipe also deletes receipt scans, voice notes, voice consents and period closes (S5)", async () => {
    await refresh(db);
    await db.insert(receiptScans).values({
      id: "demo-refresh-receipt-scan",
      workspaceId: WORKSPACE_ID,
      uploaderSubject: "maria",
      storageKey: "demo-refresh-scan-key",
      originalFilename: "boleta.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(voiceNotes).values({
      id: "demo-refresh-voice-note",
      workspaceId: WORKSPACE_ID,
      uploaderSubject: "maria",
      storageKey: "demo-refresh-voice-key",
      originalFilename: "nota.webm",
      mimeType: "audio/webm",
      sizeBytes: 20,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(voiceConsents).values({
      id: "demo-refresh-voice-consent",
      workspaceId: WORKSPACE_ID,
      subject: "maria",
      provider: "whisper",
      grantedAt: new Date(),
    });
    // A period OUTSIDE the seeded window (T5/S6 seeds active closes
    // for the past five window months — the partial unique index would
    // reject a second active close for one of those periods).
    await db.insert(periodCloses).values({
      id: "demo-refresh-period-close",
      workspaceId: WORKSPACE_ID,
      currency: "PEN",
      periodStart: new Date("2024-06-01T00:00:00Z"),
      periodEnd: new Date("2024-06-30T00:00:00Z"),
      timezone: "America/Lima",
      integrityDeclared: true,
      closedAt: new Date(),
    });

    await refreshDemoWorkspace(db, refreshOptions());

    for (const [table, id] of [
      [receiptScans, "demo-refresh-receipt-scan"],
      [voiceNotes, "demo-refresh-voice-note"],
      [voiceConsents, "demo-refresh-voice-consent"],
      [periodCloses, "demo-refresh-period-close"],
    ] as const) {
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, id));
      expect(rows).toHaveLength(0);
    }
    // Hygiene: drop the pending outbox rows the re-seed just wrote.
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.workspaceId, WORKSPACE_ID));
  });

  it("restores an archived seed category instead of failing every later refresh (R3-001)", async () => {
    await refresh(db);
    const [food] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, WORKSPACE_ID),
          eq(categories.key, "food"),
        ),
      )
      .limit(1);
    // A demo visitor archives a seed category…
    await db
      .update(categories)
      .set({ archivedAt: new Date("2026-03-10T00:00:00Z") })
      .where(eq(categories.id, food!.id));

    const result = await refresh(db);

    expect(result.generatedMonths).toEqual(EXPECTED_MONTHS);
    const [restored] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, food!.id));
    expect(restored!.archivedAt).toBeNull();
    expect(restored!.label).toBe("Comida");
    // And the re-seeded food transactions actually resolve their category.
    const rows = await db
      .select({ categoryId: ledgerTransactions.categoryId })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, WORKSPACE_ID),
          eq(ledgerTransactions.categoryId, food!.id),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
  });

  // demo-seed-six-months T5 (S6): the refreshed dataset carries the
  // period closes a real user would have made — every past window month
  // resolves `closed`, the running month stays provisional.
  it("closes the three oldest window months and leaves the running month and the two most recent open (S6)", async () => {
    await refresh(db);
    const closes = new DrizzlePeriodCloseRepository(db);
    const workspaceId = workspaceIdOrThrow(WORKSPACE_ID);
    const months = demoWindowMonths(NOW);

    // The running month must NOT be closed — a real user hasn't
    // finished it, so reports keep it provisional.
    expect(
      await closes.findActiveByPeriod(
        workspaceId,
        "PEN",
        months[0]!.start,
      ),
    ).toBeNull();

    for (const month of months.slice(1, 3)) {
      expect(
        await closes.findActiveByPeriod(workspaceId, "PEN", month.start),
        `no close for ${month.key}`,
      ).toBeNull();
    }
    for (const month of months.slice(3)) {
      const close = await closes.findActiveByPeriod(
        workspaceId,
        "PEN",
        month.start,
      );
      expect(close, `active close for ${month.key}`).not.toBeNull();
      expect(close!.stale).toBe(false);
      expect(close!.periodStart).toBe(month.start);
      expect(close!.periodEnd).toBe(monthLastDay(month.key));
      expect(close!.timezone).toBe("America/Lima");
      expect(close!.integrityDeclared).toBe(true);
      expect(close!.supersededAt).toBeNull();
      expect(close!.invalidatedAt).toBeNull();
    }
  });

  // demo-seed-six-months T5 (S6): the wipe drops the seeded closes and
  // the re-seed creates fresh ones — refresh restores the full seed
  // state, closes included, without leaving stale history rows behind.
  it("re-creates the past-month closes on every refresh (S6)", async () => {
    await refresh(db);
    await refresh(db);

    const closes = new DrizzlePeriodCloseRepository(db);
    const workspaceId = workspaceIdOrThrow(WORKSPACE_ID);
    const active = await closes.listActive(workspaceId, "PEN");
    expect(active.map((close) => close.periodStart).sort()).toEqual(
      demoWindowMonths(NOW)
        .slice(3)
        .map((month) => month.start)
        .sort(),
    );
    expect(active.every((close) => !close.stale)).toBe(true);
    // Exactly the three fresh rows — the wiped closes did not leak.
    const rows = await db
      .select({ id: periodCloses.id })
      .from(periodCloses)
      .where(eq(periodCloses.workspaceId, WORKSPACE_ID));
    expect(rows).toHaveLength(3);
  });

  it("is idempotent — every run reseeds the same deterministic window dataset (S6)", async () => {
    const first = await refresh(db);
    const firstKeys = (await transactionRows(db, WORKSPACE_ID)).map(
      (row) => row.idempotencyKey,
    );

    const again = await refresh(db);

    expect(again.workspaceCreated).toBe(false);
    // The re-seed wiped exactly what the first run inserted.
    expect(again.purgedTransactions).toBe(first.insertedTransactions);
    expect(again.generatedMonths).toEqual(EXPECTED_MONTHS);
    expect(again.insertedTransactions).toBe(first.insertedTransactions);
    const secondKeys = (await transactionRows(db, WORKSPACE_ID)).map(
      (row) => row.idempotencyKey,
    );
    expect(secondKeys.sort()).toEqual([...firstKeys].sort());
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
