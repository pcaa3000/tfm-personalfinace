import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { accounts, ledgerTransactions } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleCurrencyUsageAdapter } from "./drizzle-currency-usage.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-curusage-a";
const WS_B = "drizzle-curusage-b";
const WORKSPACES = [WS_A, WS_B];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

async function insertAccount(
  db: DrizzleDb,
  input: {
    id: string;
    workspace: string;
    name: string;
    currency: string;
    archivedAt?: Date | null;
  },
): Promise<void> {
  await db.insert(accounts).values({
    id: input.id,
    workspaceId: input.workspace,
    name: input.name,
    currency: input.currency,
    kind: "bank",
    initialBalanceMinor: 0n,
    archivedAt: input.archivedAt ?? null,
  });
}

async function insertTransaction(
  db: DrizzleDb,
  input: {
    id: string;
    workspace: string;
    idempotencyKey: string;
    currency: string;
    status?: string;
  },
): Promise<void> {
  await db.insert(ledgerTransactions).values({
    id: input.id,
    workspaceId: input.workspace,
    idempotencyKey: input.idempotencyKey,
    type: "expense",
    amountMinor: 1000n,
    currency: input.currency,
    businessDate: new Date("2026-01-15T00:00:00Z"),
    timezone: "UTC",
    concept: "usage spec",
    accountId: null,
    destinationAccountId: null,
    categoryId: null,
    status: input.status ?? "confirmed",
    origin: "manual",
    originRef: null,
    confirmedAt: new Date("2026-01-15T12:00:00Z"),
    confirmedBy: "usage-spec",
  });
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  await db.delete(accounts).where(inArray(accounts.workspaceId, WORKSPACES));
}

describe("DrizzleCurrencyUsageAdapter (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const adapter = new DrizzleCurrencyUsageAdapter(db);

  beforeAll(async () => {
    await cleanupAll(db);
    // WS_A: 2 USD accounts (one archived), 1 EUR account; 3 USD
    // transactions (one voided — still counts), 1 EUR transaction.
    await insertAccount(db, {
      id: "curusage-acc-usd-1",
      workspace: WS_A,
      name: "USD one",
      currency: "USD",
    });
    await insertAccount(db, {
      id: "curusage-acc-usd-2",
      workspace: WS_A,
      name: "USD two",
      currency: "USD",
      archivedAt: new Date(),
    });
    await insertAccount(db, {
      id: "curusage-acc-eur",
      workspace: WS_A,
      name: "EUR one",
      currency: "EUR",
    });
    await insertTransaction(db, {
      id: "curusage-tx-usd-1",
      workspace: WS_A,
      idempotencyKey: "curusage-k1",
      currency: "USD",
    });
    await insertTransaction(db, {
      id: "curusage-tx-usd-2",
      workspace: WS_A,
      idempotencyKey: "curusage-k2",
      currency: "USD",
    });
    await insertTransaction(db, {
      id: "curusage-tx-usd-void",
      workspace: WS_A,
      idempotencyKey: "curusage-k3",
      currency: "USD",
      status: "voided",
    });
    await insertTransaction(db, {
      id: "curusage-tx-eur",
      workspace: WS_A,
      idempotencyKey: "curusage-k4",
      currency: "EUR",
    });
    // WS_B owns USD rows too — they must not leak into WS_A counts.
    await insertAccount(db, {
      id: "curusage-acc-b-usd",
      workspace: WS_B,
      name: "B USD",
      currency: "USD",
    });
    await insertTransaction(db, {
      id: "curusage-tx-b-usd",
      workspace: WS_B,
      idempotencyKey: "curusage-bk1",
      currency: "USD",
    });
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("counts accounts and transactions carrying the code, active or not", async () => {
    const ws = workspaceId(WS_A);
    expect(await adapter.usageOf(ws, "USD")).toEqual({
      accounts: 2,
      transactions: 3,
    });
    expect(await adapter.usageOf(ws, "EUR")).toEqual({
      accounts: 1,
      transactions: 1,
    });
    expect(await adapter.usageOf(ws, "JPY")).toEqual({
      accounts: 0,
      transactions: 0,
    });
  });

  it("scopes usage counts to the workspace", async () => {
    expect(await adapter.usageOf(workspaceId(WS_B), "USD")).toEqual({
      accounts: 1,
      transactions: 1,
    });
  });
});
