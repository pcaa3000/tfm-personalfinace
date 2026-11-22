import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import {
  accounts,
  categories,
  currencies,
  ledgerTransactions,
  outboxEvents,
  workspaces,
} from "../../../drizzle/schema.js";
import { deleteWorkspacesCascade } from "../../../drizzle/demo-session-workspaces.js";
import { DrizzleDemoSessionService } from "./drizzle-demo-session.service.js";

/**
 * demo-maria-session T6 (S2/S3/S5/S8; L10 final model): POST
 * /demo/session mints an ephemeral `issuer|subject|sid` workspace of
 * kind `demo` and answers immediately — the María dataset is seeded
 * asynchronously (bootstrap, then months current/-1/-2) while the
 * fail-closed resolver already accepts the new sid. DELETE
 * /demo/session removes that session's workspace with its data and
 * every run also sweeps kind='demo' workspaces older than 24h.
 * Integration spec against the real Postgres.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const ISSUER = "demo-session-spec";
const SUBJECT_A = "maria-a";
const SUBJECT_B = "maria-b";

function caller(subject: string) {
  return { issuer: ISSUER, subject };
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.identityKey, `${ISSUER}|%`));
  const ids = owned.map((w) => w.id);
  if (ids.length === 0) return;
  await deleteWorkspacesCascade(db, ids);
}

async function workspaceRow(db: DrizzleDb, identityKey: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.identityKey, identityKey))
    .limit(1);
  return row ?? null;
}

async function seedCounts(db: DrizzleDb, workspaceId: string) {
  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.workspaceId, workspaceId));
  const transactionRows = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.workspaceId, workspaceId));
  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  const currencyRows = await db
    .select({ id: currencies.id })
    .from(currencies)
    .where(eq(currencies.workspaceId, workspaceId));
  return {
    accounts: accountRows.length,
    transactions: transactionRows.length,
    categories: categoryRows.length,
    currencies: currencyRows.length,
  };
}

describe("DrizzleDemoSessionService (integration, real Postgres — T6)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const service = new DrizzleDemoSessionService(db);

  /**
   * Awaits the async seed, then deletes the pending outbox rows the
   * seed wrote — otherwise they leak into the shared dev DB while the
   * parallel drain-outbox suite samples the global pending count
   * (same hygiene as refresh-demo-workspace.spec).
   */
  async function settle(): Promise<void> {
    await service.idle();
    const owned = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|%`));
    const ids = owned.map((row) => row.id);
    if (ids.length > 0) {
      await db
        .delete(outboxEvents)
        .where(inArray(outboxEvents.workspaceId, ids));
    }
  }

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await settle();
    await cleanupAll(db);
    await pool.end();
  });

  it("returns {sessionId, workspaceId} with the kind='demo' row already resolvable, then seeds the 3-month dataset async (S2/S8)", async () => {
    const session = await service.createSession(caller(SUBJECT_A));

    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const identityKey = `${ISSUER}|${SUBJECT_A}|${session.sessionId}`;
    // The row exists BEFORE the response — the fail-closed resolver
    // accepts this sid right away even though the dataset is still
    // being generated in the background.
    const row = await workspaceRow(db, identityKey);
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("demo");
    expect(row!.id).toBe(session.workspaceId);

    await settle();

    const counts = await seedCounts(db, session.workspaceId);
    expect(counts.accounts).toBe(4);
    expect(counts.transactions).toBeGreaterThan(0);
    expect(counts.categories).toBe(12);
    expect(counts.currencies).toBe(1);
  });

  it("keeps concurrent sessions' workspaces — the v2 sweep is age-based (>24h), never wipe-on-create (L10)", async () => {
    const first = await service.createSession(caller(SUBJECT_B));
    await settle();
    const firstCounts = await seedCounts(db, first.workspaceId);
    expect(firstCounts.transactions).toBeGreaterThan(0);

    const second = await service.createSession(caller(SUBJECT_B));
    await settle();

    expect(second.sessionId).not.toBe(first.sessionId);
    // The previous session workspace is still there — only an explicit
    // DELETE or the >24h orphan sweep may remove it.
    const firstRow = await workspaceRow(
      db,
      `${ISSUER}|${SUBJECT_B}|${first.sessionId}`,
    );
    expect(firstRow).not.toBeNull();
    const secondRow = await workspaceRow(
      db,
      `${ISSUER}|${SUBJECT_B}|${second.sessionId}`,
    );
    expect(secondRow).not.toBeNull();
    expect(secondRow!.kind).toBe("demo");
  });

  it("endSession removes that session's workspace AND its data, and sweeps >24h demo orphans of any subject (L10)", async () => {
    const session = await service.createSession(caller(SUBJECT_A));
    await settle();
    const seededCounts = await seedCounts(db, session.workspaceId);
    expect(seededCounts.transactions).toBeGreaterThan(0);

    // A stale orphan workspace (kind='demo', createdAt backdated >24h)
    // that no endpoint touched — endSession must sweep it too.
    const orphanIdentityKey = `${ISSUER}|${SUBJECT_B}|sid-stale-orphan`;
    const [orphan] = await db
      .insert(workspaces)
      .values({
        id: "ws-demo-session-orphan",
        identityKey: orphanIdentityKey,
        kind: "demo",
        timezone: "America/Lima",
        defaultCurrency: "PEN",
      })
      .returning();
    await db
      .update(workspaces)
      .set({ createdAt: new Date(Date.now() - 48 * 3_600_000) })
      .where(eq(workspaces.id, orphan!.id));

    await service.endSession(caller(SUBJECT_A), session.sessionId);

    expect(
      await workspaceRow(
        db,
        `${ISSUER}|${SUBJECT_A}|${session.sessionId}`,
      ),
    ).toBeNull();
    expect(await seedCounts(db, session.workspaceId)).toEqual({
      accounts: 0,
      transactions: 0,
      categories: 0,
      currencies: 0,
    });
    // The >24h orphan is gone as part of the same logout sweep.
    expect(await workspaceRow(db, orphanIdentityKey)).toBeNull();
    // But the OTHER live session's fresh workspace survives.
    const secondLive = await db
      .select()
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|${SUBJECT_B}|%`));
    expect(
      secondLive.filter((row) => row.id !== orphan!.id).length,
    ).toBeGreaterThan(0);
  });

  it("endSession is idempotent for an unknown sid — 204 semantics, no rows touched", async () => {
    const before = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|%`));

    await service.endSession(caller(SUBJECT_A), "sid-that-never-existed");

    const after = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|%`));
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });

  it("a fresh demo workspace and an old non-demo workspace survive every sweep (scoping)", async () => {
    const pinnedKey = `${ISSUER}|${SUBJECT_A}|pinned`;
    const [pinned] = await db
      .insert(workspaces)
      .values({
        id: `ws-${randomUUID()}`,
        identityKey: pinnedKey,
        kind: "personal",
        timezone: "UTC",
        defaultCurrency: "PEN",
      })
      .returning();
    // Even backdated beyond the cutoff, kind != 'demo' is never swept.
    await db
      .update(workspaces)
      .set({ createdAt: new Date(Date.now() - 72 * 3_600_000) })
      .where(eq(workspaces.id, pinned!.id));

    const session = await service.createSession(caller(SUBJECT_A));
    await settle();
    await service.endSession(caller(SUBJECT_A), session.sessionId);

    expect(await workspaceRow(db, pinnedKey)).not.toBeNull();
  });
});
