import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { categories, ledgerTransactions } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleAntExpensesReportAdapter } from "./drizzle-ant-expenses-report.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-ant-spec-a";
const WS_B = "drizzle-ant-spec-b";
const WORKSPACES = [WS_A, WS_B];

const { db, pool } = createDrizzleDb(DATABASE_URL);
const adapter = new DrizzleAntExpensesReportAdapter(db);

const CAT_COFFEE = "cat-ant-coffee";
const CAT_ESSENTIAL = "cat-ant-essential";

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
  categoryId?: string | null;
  merchant?: string | null;
  status?: string;
}) {
  seq += 1;
  return {
    id: `tx-ant-${seq}`,
    workspaceId: values.workspaceId ?? WS_A,
    idempotencyKey: `idem-ant-${seq}`,
    type: values.type,
    amountMinor: values.amountMinor,
    currency: values.currency ?? "EUR",
    businessDate: new Date(`${values.businessDate}T00:00:00Z`),
    timezone: "UTC",
    concept: `concept-ant-${seq}`,
    merchant: values.merchant ?? null,
    accountId: null,
    destinationAccountId: null,
    categoryId: values.categoryId ?? null,
    status: values.status ?? "confirmed",
    origin: "manual",
    confirmedAt: new Date("2026-09-15T12:00:00Z"),
    confirmedBy: "spec-user",
  };
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  await db
    .delete(categories)
    .where(inArray(categories.workspaceId, WORKSPACES));
}

beforeAll(async () => {
  await cleanupAll(db);
  await db.insert(categories).values([
    {
      id: CAT_COFFEE,
      key: "spec_ant_coffee",
      label: "Spec coffee",
      nature: "discretionary",
      workspaceId: WS_A,
    },
    {
      id: CAT_ESSENTIAL,
      key: "spec_ant_essential",
      label: "Spec essential",
      nature: "essential",
      workspaceId: WS_A,
    },
    {
      id: "cat-ant-b",
      key: "spec_ant_b",
      label: "Spec other ws",
      nature: "discretionary",
      workspaceId: WS_B,
    },
  ]);

  await db.insert(ledgerTransactions).values([
    // Eligible: confirmed discretionary expenses in the window.
    tx({ type: "expense", amountMinor: 300n, businessDate: "2026-09-05", categoryId: CAT_COFFEE, merchant: "cafe central" }),
    tx({ type: "expense", amountMinor: 400n, businessDate: "2026-09-10", categoryId: CAT_COFFEE, merchant: "cafe central" }),
    tx({ type: "expense", amountMinor: 500n, businessDate: "2026-09-20", categoryId: CAT_COFFEE, merchant: null }),
    // Excluded rows.
    tx({ type: "expense", amountMinor: 900n, businessDate: "2026-09-10", categoryId: CAT_ESSENTIAL, merchant: "market" }), // essential nature
    tx({ type: "expense", amountMinor: 800n, businessDate: "2026-09-10", categoryId: null, merchant: "uncat" }), // NULL categoryId
    tx({ type: "expense", amountMinor: 700n, businessDate: "2026-09-10", categoryId: CAT_COFFEE, merchant: "cafe central", status: "voided" }),
    tx({ type: "expense", amountMinor: 600n, currency: "USD", businessDate: "2026-09-10", categoryId: CAT_COFFEE, merchant: "cafe central" }),
    tx({ type: "expense", amountMinor: 500n, businessDate: "2026-10-01", categoryId: CAT_COFFEE, merchant: "cafe central" }),
    tx({ type: "expense", amountMinor: 400n, businessDate: "2026-09-10", categoryId: "cat-ant-b", workspaceId: WS_B }),
    // Income feeding confirmedIncomeMinor.
    tx({ type: "income", amountMinor: 100_000n, businessDate: "2026-09-02" }),
    tx({ type: "income", amountMinor: 50_000n, businessDate: "2026-09-25" }),
    tx({ type: "income", amountMinor: 40_000n, businessDate: "2026-09-10", status: "voided" }),
    tx({ type: "income", amountMinor: 30_000n, currency: "USD", businessDate: "2026-09-10" }),
    tx({ type: "income", amountMinor: 20_000n, businessDate: "2026-10-01" }),
    tx({ type: "transfer", amountMinor: 10_000n, businessDate: "2026-09-10" }),
  ]);
});

afterAll(async () => {
  await cleanupAll(db);
  await pool.end();
});

describe("DrizzleAntExpensesReportAdapter", () => {
  it("returns only confirmed discretionary expense lines with merchant and category fields", async () => {
    const rows = await adapter.discretionaryExpenseLines(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.transactionId)).toEqual([
      "tx-ant-1",
      "tx-ant-2",
      "tx-ant-3",
    ]);
    expect(rows.map((r) => r.amountMinor)).toEqual([300n, 400n, 500n]);
    expect(rows[0]).toMatchObject({
      merchant: "cafe central",
      categoryId: CAT_COFFEE,
      categoryKey: "spec_ant_coffee",
      categoryLabel: "Spec coffee",
    });
    expect(rows[2]?.merchant).toBeNull();
  });

  it("sums confirmed income in the window and currency", async () => {
    const income = await adapter.confirmedIncomeMinor(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    expect(income).toBe(150_000n);
  });

  it("returns zero income when nothing matches", async () => {
    const income = await adapter.confirmedIncomeMinor(
      workspaceId(WS_A),
      "PEN",
      "2026-09-01",
      "2026-09-30",
    );

    expect(income).toBe(0n);
  });
});
