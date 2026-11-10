import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { accounts, ledgerTransactions } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleBalanceAdapter } from "./drizzle-balance.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-balance-spec-a";
const WS_B = "drizzle-balance-spec-b";

const db = createDrizzleDb(DATABASE_URL).db;
const adapter = new DrizzleBalanceAdapter(db);

function workspaceId(value: string): WorkspaceId {
  const result = WorkspaceId.create(value);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

let txSeq = 0;
function txRow(overrides: Record<string, unknown>) {
  txSeq += 1;
  return {
    id: `bal-tx-${txSeq}`,
    workspaceId: WS_A,
    idempotencyKey: `bal-${txSeq}`,
    type: "expense",
    amountMinor: 0n,
    currency: "PEN",
    businessDate: new Date("2026-11-01T00:00:00Z"),
    timezone: "UTC",
    concept: "balance spec",
    status: "confirmed",
    origin: "manual",
    confirmedAt: new Date("2026-11-01T12:00:00Z"),
    confirmedBy: "spec",
    ...overrides,
  };
}

beforeAll(async () => {
  await db.insert(accounts).values([
    // two active PEN accounts: 5000.00 + 200.00 = 5200.00 initial
    {
      id: "bal-acc-pen-1",
      workspaceId: WS_A,
      name: "PEN banco",
      currency: "PEN",
      initialBalanceMinor: 500000n,
    },
    {
      id: "bal-acc-pen-2",
      workspaceId: WS_A,
      name: "PEN efectivo",
      currency: "PEN",
      initialBalanceMinor: 20000n,
    },
    {
      id: "bal-acc-usd",
      workspaceId: WS_A,
      name: "USD banco",
      currency: "USD",
      initialBalanceMinor: 120000n,
    },
    {
      // archived accounts do not count toward the balance
      id: "bal-acc-archived",
      workspaceId: WS_A,
      name: "PEN archivada",
      currency: "PEN",
      initialBalanceMinor: 999000n,
      archivedAt: new Date("2026-11-02T00:00:00Z"),
    },
    {
      id: "bal-acc-other-ws",
      workspaceId: WS_B,
      name: "PEN otro ws",
      currency: "PEN",
      initialBalanceMinor: 777700n,
    },
  ]);
  await db.insert(ledgerTransactions).values([
    txRow({ type: "income", amountMinor: 450000n }),
    txRow({ type: "expense", amountMinor: 56575n }),
    txRow({ type: "income", currency: "USD", amountMinor: 85000n }),
    txRow({ type: "expense", currency: "USD", amountMinor: 6598n }),
    // transfers are net-0: never income nor expense in a currency balance
    txRow({ type: "transfer", amountMinor: 999000n }),
    // voided transactions do not count
    txRow({ type: "expense", amountMinor: 10000n, status: "voided" }),
    // other workspace activity is isolated
    txRow({ workspaceId: WS_B, type: "income", amountMinor: 777700n }),
  ]);
});

afterAll(async () => {
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, [WS_A, WS_B]));
  await db
    .delete(accounts)
    .where(inArray(accounts.workspaceId, [WS_A, WS_B]));
});

describe("DrizzleBalanceAdapter", () => {
  it("aggregates initial balances and confirmed income/expenses per currency", async () => {
    const items = await adapter.sumByCurrency(workspaceId(WS_A));

    expect(items).toEqual([
      {
        currency: "PEN",
        initialBalanceMinor: 520000n,
        incomeMinor: 450000n,
        expenseMinor: 56575n,
      },
      {
        currency: "USD",
        initialBalanceMinor: 120000n,
        incomeMinor: 85000n,
        expenseMinor: 6598n,
      },
    ]);
  });

  it("isolates totals per workspace", async () => {
    const items = await adapter.sumByCurrency(workspaceId(WS_B));

    expect(items).toEqual([
      {
        currency: "PEN",
        initialBalanceMinor: 777700n,
        incomeMinor: 777700n,
        expenseMinor: 0n,
      },
    ]);
  });
});
