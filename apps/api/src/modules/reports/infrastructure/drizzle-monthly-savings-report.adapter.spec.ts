import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { categories, ledgerTransactions } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleMonthlySavingsReportAdapter } from "./drizzle-monthly-savings-report.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-sav-spec-a";
const WS_B = "drizzle-sav-spec-b";
const WORKSPACES = [WS_A, WS_B];

const { db, pool } = createDrizzleDb(DATABASE_URL);
const adapter = new DrizzleMonthlySavingsReportAdapter(db);

const CAT_DISC = "cat-sav-disc";

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
  status?: string;
}) {
  seq += 1;
  return {
    id: `tx-sav-${seq}`,
    workspaceId: values.workspaceId ?? WS_A,
    idempotencyKey: `idem-sav-${seq}`,
    type: values.type,
    amountMinor: values.amountMinor,
    currency: values.currency ?? "EUR",
    businessDate: new Date(`${values.businessDate}T00:00:00Z`),
    timezone: "UTC",
    concept: `concept-sav-${seq}`,
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
      id: CAT_DISC,
      key: "spec_sav_disc",
      label: "Spec discretionary",
      nature: "discretionary",
      workspaceId: WS_A,
    },
  ]);

  await db.insert(ledgerTransactions).values([
    // In window, EUR, confirmed.
    tx({ type: "income", amountMinor: 1_000_000n, businessDate: "2026-09-02" }),
    tx({ type: "income", amountMinor: 50_000n, businessDate: "2026-09-25" }),
    tx({ type: "expense", amountMinor: 300_000n, businessDate: "2026-09-10", categoryId: CAT_DISC }),
    // Uncategorized expense still counts towards the expense total.
    tx({ type: "expense", amountMinor: 100_000n, businessDate: "2026-09-11", categoryId: null }),
    // Excluded rows.
    tx({ type: "expense", amountMinor: 90_000n, businessDate: "2026-09-10", status: "voided" }),
    tx({ type: "income", amountMinor: 80_000n, businessDate: "2026-09-10", status: "voided" }),
    tx({ type: "expense", amountMinor: 70_000n, currency: "USD", businessDate: "2026-09-10" }),
    tx({ type: "expense", amountMinor: 60_000n, businessDate: "2026-10-01" }),
    tx({ type: "expense", amountMinor: 50_000n, businessDate: "2026-09-10", workspaceId: WS_B }),
    tx({ type: "transfer", amountMinor: 40_000n, businessDate: "2026-09-10" }),
  ]);
});

afterAll(async () => {
  await cleanupAll(db);
  await pool.end();
});

describe("DrizzleMonthlySavingsReportAdapter", () => {
  it("sums confirmed income and every-nature expense inside the window", async () => {
    const totals = await adapter.incomeExpenseTotals(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    expect(totals.incomeMinor).toBe(1_050_000n);
    expect(totals.expenseMinor).toBe(400_000n);
  });

  it("returns zeroed totals for an empty period", async () => {
    const totals = await adapter.incomeExpenseTotals(
      workspaceId(WS_A),
      "PEN",
      "2026-09-01",
      "2026-09-30",
    );

    expect(totals).toEqual({ incomeMinor: 0n, expenseMinor: 0n });
  });
});
