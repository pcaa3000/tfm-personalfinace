import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import {
  accounts,
  ledgerTransactionSplits,
  ledgerTransactions,
} from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleCashFlowReportAdapter } from "./drizzle-cash-flow-report.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-cf-spec-a";
const WS_B = "drizzle-cf-spec-b";
const WORKSPACES = [WS_A, WS_B];

const { db, pool } = createDrizzleDb(DATABASE_URL);
const adapter = new DrizzleCashFlowReportAdapter(db);

const ACC_SRC = "acc-cf-src";
const ACC_DST = "acc-cf-dst";
const ACC_USD = "acc-cf-usd";

function workspaceId(value: string): WorkspaceId {
  const result = WorkspaceId.create(value);
  if (!result.ok) throw result.error;
  return result.value;
}

let seq = 0;
function tx(values: {
  workspaceId?: string;
  type: string;
  amountMinor: bigint;
  currency?: string;
  businessDate: string;
  accountId?: string | null;
  destinationAccountId?: string | null;
  categoryId?: string | null;
  status?: string;
}) {
  seq += 1;
  return {
    id: `tx-cf-${seq}`,
    workspaceId: values.workspaceId ?? WS_A,
    idempotencyKey: `idem-cf-${seq}`,
    type: values.type,
    amountMinor: values.amountMinor,
    currency: values.currency ?? "EUR",
    businessDate: new Date(`${values.businessDate}T00:00:00Z`),
    timezone: "UTC",
    concept: `concept-cf-${seq}`,
    accountId: values.accountId ?? null,
    destinationAccountId: values.destinationAccountId ?? null,
    categoryId: values.categoryId ?? null,
    status: values.status ?? "confirmed",
    origin: "manual",
    confirmedAt: new Date("2026-09-15T12:00:00Z"),
    confirmedBy: "spec-user",
  };
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  const rows = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db
      .delete(ledgerTransactionSplits)
      .where(inArray(ledgerTransactionSplits.transactionId, ids));
  }
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  await db.delete(accounts).where(inArray(accounts.workspaceId, WORKSPACES));
}

async function seedAccounts(db: DrizzleDb): Promise<void> {
  await db.insert(accounts).values([
    {
      id: ACC_SRC,
      workspaceId: WS_A,
      name: "Source account",
      currency: "EUR",
      kind: "bank",
      initialBalanceMinor: 0n,
    },
    {
      id: ACC_DST,
      workspaceId: WS_A,
      name: "Destination account",
      currency: "EUR",
      kind: "cash",
      initialBalanceMinor: 0n,
    },
    {
      id: ACC_USD,
      workspaceId: WS_A,
      name: "USD account",
      currency: "USD",
      kind: "bank",
      initialBalanceMinor: 0n,
    },
    {
      id: "acc-cf-b",
      workspaceId: WS_B,
      name: "Other workspace",
      currency: "EUR",
      kind: "bank",
      initialBalanceMinor: 0n,
    },
  ]);
}

beforeAll(async () => {
  await cleanupAll(db);
  await seedAccounts(db);
  await db.insert(ledgerTransactions).values([
    tx({ type: "income", amountMinor: 10000n, businessDate: "2026-09-05", accountId: ACC_SRC }),
    tx({ type: "expense", amountMinor: 4050n, businessDate: "2026-09-10", accountId: ACC_SRC }),
    tx({
      type: "transfer",
      amountMinor: 3000n,
      businessDate: "2026-09-12",
      accountId: ACC_SRC,
      destinationAccountId: ACC_DST,
    }),
    tx({ type: "income", amountMinor: 20000n, businessDate: "2026-09-15", accountId: ACC_DST }),
    tx({
      type: "transfer",
      amountMinor: 800n,
      businessDate: "2026-09-21",
      accountId: ACC_SRC,
      destinationAccountId: null,
    }),
    tx({ type: "expense", amountMinor: 1525n, businessDate: "2026-09-20", accountId: null }),
    // Excluded rows: wrong currency, voided, outside the window, other workspace.
    tx({ type: "expense", amountMinor: 99900n, currency: "USD", businessDate: "2026-09-15", accountId: ACC_USD }),
    tx({ type: "expense", amountMinor: 7000n, businessDate: "2026-09-15", accountId: ACC_SRC, status: "voided" }),
    tx({ type: "income", amountMinor: 5500n, businessDate: "2026-08-31", accountId: ACC_SRC }),
    tx({ type: "income", amountMinor: 500n, businessDate: "2026-09-15", accountId: "acc-cf-b", workspaceId: WS_B }),
  ]);
});

afterAll(async () => {
  await cleanupAll(db);
  await pool.end();
});

describe("DrizzleCashFlowReportAdapter", () => {
  it("aggregates confirmed income/expense/transfers per account over the window", async () => {
    const rows = await adapter.totalsPerAccount(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    const byAccount = new Map(rows.map((r) => [r.accountId, r]));

    const src = byAccount.get(ACC_SRC);
    expect(src).toMatchObject({
      accountName: "Source account",
      accountKind: "bank",
      incomeMinor: 10000n,
      expenseMinor: 4050n,
      transfersInMinor: 0n,
      transfersOutMinor: 3800n,
    });

    const dst = byAccount.get(ACC_DST);
    expect(dst).toMatchObject({
      accountName: "Destination account",
      accountKind: "cash",
      incomeMinor: 20000n,
      expenseMinor: 0n,
      transfersInMinor: 3000n,
      transfersOutMinor: 0n,
    });

    // Transfers are never income/expense (CA-023): the source's income
    // stays 100.00 and the destination's expense stays 0.
    expect(src?.transfersOutMinor).toBe(3800n);
    expect(dst?.expenseMinor).toBe(0n);
  });

  it("groups NULL accountId rows into the unassigned bucket", async () => {
    const rows = await adapter.totalsPerAccount(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    const unassigned = rows.find((r) => r.accountId === null);
    expect(unassigned).toMatchObject({
      accountName: null,
      accountKind: null,
      incomeMinor: 0n,
      expenseMinor: 1525n,
      transfersInMinor: 800n,
      transfersOutMinor: 0n,
    });
  });

  it("excludes voided, other-currency, out-of-window and other-workspace rows", async () => {
    const rows = await adapter.totalsPerAccount(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    const byAccount = new Map(rows.map((r) => [r.accountId, r]));
    expect(byAccount.get(ACC_USD)).toBeUndefined();
    expect(byAccount.get("acc-cf-b")).toBeUndefined();
    // Only the seeded non-excluded groups remain.
    expect(new Set(rows.map((r) => r.accountId))).toEqual(
      new Set([ACC_SRC, ACC_DST, null]),
    );
  });
});
