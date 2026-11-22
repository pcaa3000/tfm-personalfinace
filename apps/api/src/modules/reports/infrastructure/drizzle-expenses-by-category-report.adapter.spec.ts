import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import {
  categories,
  ledgerTransactionSplits,
  ledgerTransactions,
} from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleExpensesByCategoryReportAdapter } from "./drizzle-expenses-by-category-report.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-ec-spec-a";
const WS_B = "drizzle-ec-spec-b";
const WORKSPACES = [WS_A, WS_B];

const { db, pool } = createDrizzleDb(DATABASE_URL);
const adapter = new DrizzleExpensesByCategoryReportAdapter(db);

const CAT_FOOD = "cat-ec-food";
const CAT_FUN = "cat-ec-fun";
const CAT_UNCAT = "cat-ec-uncat";

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
    id: `tx-ec-${seq}`,
    workspaceId: values.workspaceId ?? WS_A,
    idempotencyKey: `idem-ec-${seq}`,
    type: values.type,
    amountMinor: values.amountMinor,
    currency: values.currency ?? "EUR",
    businessDate: new Date(`${values.businessDate}T00:00:00Z`),
    timezone: "UTC",
    concept: `concept-ec-${seq}`,
    accountId: null,
    destinationAccountId: null,
    categoryId: values.categoryId ?? null,
    status: values.status ?? "confirmed",
    origin: "manual",
    confirmedAt: new Date("2026-09-15T12:00:00Z"),
    confirmedBy: "spec-user",
  };
}

let splitSeq = 0;
function split(transactionId: string, categoryId: string, amountMinor: bigint) {
  splitSeq += 1;
  return {
    id: `split-ec-${splitSeq}`,
    transactionId,
    categoryId,
    amountMinor,
    position: splitSeq,
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
  await db
    .delete(categories)
    .where(inArray(categories.workspaceId, WORKSPACES));
}

beforeAll(async () => {
  await cleanupAll(db);
  await db.insert(categories).values([
    {
      id: CAT_FOOD,
      key: "spec_ec_food",
      label: "Spec food",
      nature: "essential",
      workspaceId: WS_A,
    },
    {
      id: CAT_FUN,
      key: "spec_ec_fun",
      label: "Spec fun",
      nature: "discretionary",
      workspaceId: WS_A,
    },
    // A category carrying the system 'uncategorized' nature marker —
    // outside CategoryNature, mapped explicitly by the report.
    {
      id: CAT_UNCAT,
      key: "spec_ec_uncat",
      label: "Sin categorizar",
      nature: "uncategorized",
      workspaceId: WS_A,
    },
    {
      id: "cat-ec-b",
      key: "spec_ec_b",
      label: "Spec other ws",
      nature: "essential",
      workspaceId: WS_B,
    },
  ]);

  const headOnly = tx({
    type: "expense",
    amountMinor: 3000n,
    businessDate: "2026-09-05",
    categoryId: CAT_FOOD,
  });
  const noCategory = tx({
    type: "expense",
    amountMinor: 2000n,
    businessDate: "2026-09-06",
    categoryId: null,
  });
  const splitTx = tx({
    type: "expense",
    amountMinor: 5000n,
    businessDate: "2026-09-07",
    // Head category is ignored when splits exist (INV-TRX-SPLIT-01).
    categoryId: CAT_FOOD,
  });
  const splitUncat = tx({
    type: "expense",
    amountMinor: 1200n,
    businessDate: "2026-09-08",
    categoryId: CAT_UNCAT,
  });
  await db.insert(ledgerTransactions).values([
    headOnly,
    noCategory,
    splitTx,
    splitUncat,
    // Excluded rows: income, transfer, voided, other currency, outside
    // the window, other workspace.
    tx({ type: "income", amountMinor: 9900n, businessDate: "2026-09-10", categoryId: CAT_FOOD }),
    tx({ type: "transfer", amountMinor: 8800n, businessDate: "2026-09-10", categoryId: CAT_FUN }),
    tx({ type: "expense", amountMinor: 7000n, businessDate: "2026-09-10", categoryId: CAT_FOOD, status: "voided" }),
    tx({ type: "expense", amountMinor: 6000n, currency: "USD", businessDate: "2026-09-10", categoryId: CAT_FOOD }),
    tx({ type: "expense", amountMinor: 5000n, businessDate: "2026-10-01", categoryId: CAT_FOOD }),
    tx({ type: "expense", amountMinor: 4000n, businessDate: "2026-09-10", categoryId: "cat-ec-b", workspaceId: WS_B }),
  ]);
  await db.insert(ledgerTransactionSplits).values([
    split(splitTx.id, CAT_FUN, 4000n),
    split(splitTx.id, CAT_FOOD, 1000n),
    split(splitUncat.id, CAT_UNCAT, 1200n),
  ]);
});

afterAll(async () => {
  await cleanupAll(db);
  await pool.end();
});

describe("DrizzleExpensesByCategoryReportAdapter", () => {
  it("aggregates confirmed expenses per category over the window", async () => {
    const rows = await adapter.totalsPerCategory(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
      "2026-09-30",
    );

    const byId = new Map(rows.map((r) => [r.categoryId, r]));

    expect(byId.get(CAT_FOOD)).toMatchObject({
      categoryKey: "spec_ec_food",
      categoryLabel: "Spec food",
      nature: "essential",
      totalMinor: 4000n,
      transactionCount: 2,
    });
    expect(byId.get(CAT_FUN)).toMatchObject({
      categoryKey: "spec_ec_fun",
      categoryLabel: "Spec fun",
      nature: "discretionary",
      totalMinor: 4000n,
      transactionCount: 1,
    });
    expect(byId.get(CAT_UNCAT)).toMatchObject({
      nature: "uncategorized",
      totalMinor: 1200n,
      transactionCount: 1,
    });
    expect(byId.get(null)).toMatchObject({
      categoryKey: null,
      categoryLabel: null,
      nature: null,
      totalMinor: 2000n,
      transactionCount: 1,
    });
    expect(rows).toHaveLength(4);
  });
});
