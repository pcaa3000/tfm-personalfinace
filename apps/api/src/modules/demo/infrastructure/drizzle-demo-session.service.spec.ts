import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
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
import { DrizzleDemoSessionService } from "./drizzle-demo-session.service.js";

/**
 * demo-maria-session T1 (S2/S3/S8): every demo login materializes an
 * ephemeral `issuer|subject|sid` workspace of kind `demo` seeded with
 * the "María" dataset; creating a new session wipes the subject's
 * previous demo workspaces — data never persists across sessions.
 * Integration spec against the real Postgres so the advisory lock +
 * cascade-safe delete order run for real.
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
  const txIds = db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, ids));
  await db
    .delete(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.transactionId, txIds));
  await db
    .delete(ledgerTransactionRevisions)
    .where(inArray(ledgerTransactionRevisions.transactionId, txIds));
  await db
    .delete(receiptScans)
    .where(inArray(receiptScans.workspaceId, ids));
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, ids));
  await db.delete(accounts).where(inArray(accounts.workspaceId, ids));
  await db.delete(outboxEvents).where(inArray(outboxEvents.workspaceId, ids));
  await db
    .delete(notifications)
    .where(inArray(notifications.workspaceId, ids));
  await db.delete(categories).where(inArray(categories.workspaceId, ids));
  await db.delete(currencies).where(inArray(currencies.workspaceId, ids));
  await db.delete(workspaces).where(inArray(workspaces.id, ids));
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
    .select()
    .from(accounts)
    .where(eq(accounts.workspaceId, workspaceId));
  const transactionRows = await db
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.workspaceId, workspaceId));
  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.workspaceId, workspaceId));
  const currencyRows = await db
    .select()
    .from(currencies)
    .where(eq(currencies.workspaceId, workspaceId));
  return {
    accounts: accountRows.length,
    transactions: transactionRows.length,
    categories: categoryRows.length,
    currencies: currencyRows.length,
  };
}

describe("DrizzleDemoSessionService (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const service = new DrizzleDemoSessionService(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("creates a kind='demo' workspace `issuer|subject|sid` seeded with the María dataset (S2)", async () => {
    const session = await service.createSession(caller(SUBJECT_A));

    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const identityKey = `${ISSUER}|${SUBJECT_A}|${session.sessionId}`;
    const row = await workspaceRow(db, identityKey);
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("demo");
    expect(row!.id).toBe(session.workspaceId);

    const counts = await seedCounts(db, row!.id);
    expect(counts.accounts).toBeGreaterThan(0);
    expect(counts.transactions).toBeGreaterThan(0);
    expect(counts.categories).toBeGreaterThan(0);
    expect(counts.currencies).toBe(1);
  });

  it("wipes the subject's previous demo workspaces — data included — when a new session is created (S3/S8)", async () => {
    const first = await service.createSession(caller(SUBJECT_B));
    const firstIdentityKey = `${ISSUER}|${SUBJECT_B}|${first.sessionId}`;
    const firstCounts = await seedCounts(db, first.workspaceId);
    expect(firstCounts.transactions).toBeGreaterThan(0);

    const second = await service.createSession(caller(SUBJECT_B));

    expect(second.sessionId).not.toBe(first.sessionId);
    // The previous demo workspace is gone — row AND data.
    expect(await workspaceRow(db, firstIdentityKey)).toBeNull();
    expect(await seedCounts(db, first.workspaceId)).toEqual({
      accounts: 0,
      transactions: 0,
      categories: 0,
      currencies: 0,
    });
    // The new session has its own fully seeded workspace.
    const row = await workspaceRow(
      db,
      `${ISSUER}|${SUBJECT_B}|${second.sessionId}`,
    );
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("demo");
    const secondCounts = await seedCounts(db, second.workspaceId);
    expect(secondCounts.transactions).toBe(firstCounts.transactions);
  });

  it("keeps other subjects' demo workspaces and non-demo workspaces untouched (S8 scoping)", async () => {
    // A non-demo workspace that matches the `issuer|subject|` prefix must
    // survive the cleanup: only kind='demo' rows are disposable.
    const pinnedKey = `${ISSUER}|${SUBJECT_B}|pinned`;
    await db.insert(workspaces).values({
      id: `ws-${randomUUID()}`,
      identityKey: pinnedKey,
      kind: "personal",
      timezone: "UTC",
      defaultCurrency: "PEN",
    });

    const before = await workspaceRow(db, pinnedKey);
    expect(before!.kind).toBe("personal");

    const bSession = await service.createSession(caller(SUBJECT_B));

    // The personal workspace under the same prefix is NOT wiped.
    expect(await workspaceRow(db, pinnedKey)).not.toBeNull();
    // Subject A's demo workspace from the first spec is also untouched.
    const aRows = await db
      .select()
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|${SUBJECT_A}|%`));
    expect(aRows).toHaveLength(1);
    expect(aRows[0]!.kind).toBe("demo");
    // And subject B now has exactly one fresh demo workspace.
    const bRows = await db
      .select()
      .from(workspaces)
      .where(like(workspaces.identityKey, `${ISSUER}|${SUBJECT_B}|%`));
    const bDemo = bRows.filter((row) => row.kind === "demo");
    expect(bDemo).toHaveLength(1);
    expect(bDemo[0]!.id).toBe(bSession.workspaceId);
  });
});
