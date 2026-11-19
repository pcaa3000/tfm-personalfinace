import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { ledgerTransactions } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleTransactionDuplicatesAdapter } from "./drizzle-transaction-duplicates.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "dup-spec-a";
const WS_B = "dup-spec-b";
const WORKSPACES = [WS_A, WS_B];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) throw id.error;
  return id.value;
}

function seedRow(overrides: Partial<{
  id: string;
  workspaceId: string;
  type: string;
  amountMinor: bigint;
  businessDate: string;
  concept: string;
  status: string;
}>): typeof ledgerTransactions.$inferInsert {
  const id = overrides.id ?? "trx-seed";
  return {
    id,
    workspaceId: overrides.workspaceId ?? WS_A,
    idempotencyKey: `dup-spec-${id}`,
    type: overrides.type ?? "expense",
    amountMinor: overrides.amountMinor ?? 2550n,
    currency: "PEN",
    businessDate: new Date(
      `${overrides.businessDate ?? "2026-11-10"}T00:00:00Z`,
    ),
    timezone: "UTC",
    concept: overrides.concept ?? "Seed",
    status: overrides.status ?? "confirmed",
    origin: "manual",
    confirmedAt: new Date("2026-11-10T12:00:00.000Z"),
    confirmedBy: "spec",
  };
}

async function cleanupAll(
  db: ReturnType<typeof createDrizzleDb>["db"],
): Promise<void> {
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
}

describe("DrizzleTransactionDuplicatesAdapter (integration, real Postgres, T13/S12)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const adapter = new DrizzleTransactionDuplicatesAdapter(db);

  beforeAll(async () => {
    await cleanupAll(db);
    await db.insert(ledgerTransactions).values([
      // Same amount + inside the ±3d window + matching merchant.
      seedRow({
        id: "trx-both",
        businessDate: "2026-11-09",
        concept: "Bodega Central",
      }),
      // Same amount + merchant match, but OUTSIDE the date window.
      seedRow({
        id: "trx-merchant",
        businessDate: "2026-10-01",
        concept: "Compra BODEGA CENTRAL online",
      }),
      // Same amount + inside the window, unrelated merchant.
      seedRow({
        id: "trx-date",
        businessDate: "2026-11-10",
        concept: "Farmacia Inkafarma",
      }),
      // Same amount/window/merchant but VOIDED — must be excluded.
      seedRow({
        id: "trx-voided",
        businessDate: "2026-11-10",
        concept: "Bodega Central",
        status: "voided",
      }),
      // Same amount/window/merchant but INCOME — excluded.
      seedRow({
        id: "trx-income",
        type: "income",
        businessDate: "2026-11-10",
        concept: "Bodega Central",
      }),
      // Window + merchant but a DIFFERENT amount — excluded.
      seedRow({
        id: "trx-amount",
        amountMinor: 3000n,
        businessDate: "2026-11-10",
        concept: "Bodega Central",
      }),
      // Identical signals in ANOTHER workspace — excluded.
      seedRow({
        id: "trx-foreign",
        workspaceId: WS_B,
        businessDate: "2026-11-09",
        concept: "Bodega Central",
      }),
    ]);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("matches by amount + date window OR amount + merchant (ILIKE), workspace-scoped", async () => {
    const candidates = await adapter.findExpenseCandidates(
      workspaceId(WS_A),
      {
        amountMinorUnits: 2550,
        fromDate: "2026-11-07",
        toDate: "2026-11-13",
        merchant: "Bodega Central",
      },
    );

    const ids = candidates.map((c) => c.transactionId).sort();
    expect(ids).toEqual(["trx-both", "trx-date", "trx-merchant"]);
    const both = candidates.find((c) => c.transactionId === "trx-both")!;
    expect(both.concept).toBe("Bodega Central");
    expect(both.amount).toBe(2550);
    expect(both.occurredOn).toBe("2026-11-09");
  });

  it("merchant-only criteria still finds candidates outside any window", async () => {
    const candidates = await adapter.findExpenseCandidates(
      workspaceId(WS_A),
      { amountMinorUnits: 2550, merchant: "bodega central" },
    );

    expect(candidates.map((c) => c.transactionId).sort()).toEqual([
      "trx-both",
      "trx-merchant",
    ]);
  });

  it("returns an empty list when nothing matches the amount", async () => {
    const candidates = await adapter.findExpenseCandidates(
      workspaceId(WS_A),
      {
        amountMinorUnits: 9999,
        fromDate: "2026-11-07",
        toDate: "2026-11-13",
        merchant: "Bodega Central",
      },
    );

    expect(candidates).toEqual([]);
  });

  it("returns an empty list without any semantic signal (no window, no merchant)", async () => {
    const candidates = await adapter.findExpenseCandidates(
      workspaceId(WS_A),
      { amountMinorUnits: 2550 },
    );

    expect(candidates).toEqual([]);
  });
});
