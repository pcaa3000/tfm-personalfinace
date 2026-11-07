import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../../drizzle/db.js";
import {
  accounts,
  ledgerTransactionRevisions,
  ledgerTransactions,
} from "../../../../drizzle/schema.js";
import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../../shared-kernel/index.js";
import {
  Transaction,
  type TransactionType,
} from "../../domain/transaction.js";
import { DrizzleTransactionRepository } from "./drizzle-transaction.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-tx-spec-a";
const WS_B = "drizzle-tx-spec-b";
const WORKSPACES = [WS_A, WS_B];

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function workspaceId(value: string): WorkspaceId {
  return unwrap(WorkspaceId.create(value));
}

function businessDate(isoDate: string): BusinessDate {
  return unwrap(BusinessDate.create(isoDate, "UTC"));
}

function money(raw: string, currency = "USD"): Money {
  return unwrap(Money.create(raw, currency));
}

interface TxnInput {
  id?: string;
  workspaceId?: WorkspaceId;
  idempotencyKey?: string;
  type?: TransactionType;
  amount?: Money;
  businessDate?: BusinessDate;
  concept?: string;
  accountId?: string | null;
  destinationAccountId?: string | null;
  category?: "uncategorized" | string;
}

let seq = 0;
// Real account ids seeded in beforeAll — accountId is an FK to
// accounts_accounts, so placeholder ids cannot be persisted.
const ACCOUNTS: Record<string, { source: string; dest: string }> = {
  [WS_A]: { source: "acc-tx-a-src", dest: "acc-tx-a-dst" },
  [WS_B]: { source: "acc-tx-b-src", dest: "acc-tx-b-dst" },
};

function defaultAccountId(workspace: WorkspaceId): string {
  return ACCOUNTS[workspace.value]?.source ?? "acc-missing";
}

function makeTransaction(input: TxnInput = {}): Transaction {
  seq += 1;
  const type = input.type ?? "expense";
  const workspace = input.workspaceId ?? workspaceId(WS_A);
  const record = Transaction.recordManual({
    id: input.id ?? `tx-${randomUUID()}`,
    workspaceId: workspace,
    idempotencyKey: input.idempotencyKey ?? `idem-${randomUUID()}`,
    type,
    amount: input.amount ?? money("10.00"),
    businessDate: input.businessDate ?? businessDate("2026-11-01"),
    concept: input.concept ?? `concept-${seq}`,
    // RecordManualInput.accountId is a non-null string; null is only
    // meaningful on reconstituted rows, so tests map it to the seeded account.
    accountId:
      input.accountId === undefined || input.accountId === null
        ? defaultAccountId(workspace)
        : input.accountId,
    ...(input.destinationAccountId !== undefined
      ? { destinationAccountId: input.destinationAccountId }
      : {}),
    ...(input.category !== undefined
      ? {
          category:
            input.category === "uncategorized"
              ? ({ kind: "uncategorized" } as const)
              : ({ kind: "categorized", categoryId: input.category } as const),
        }
      : {}),
    confirmedAt: new Date("2026-11-01T12:00:00Z"),
    confirmedBy: "spec-user",
  });
  return unwrap(record);
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  const txRows = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  const txIds = txRows.map((r) => r.id);
  if (txIds.length > 0) {
    await db
      .delete(ledgerTransactionRevisions)
      .where(inArray(ledgerTransactionRevisions.transactionId, txIds));
  }
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
  await db.delete(accounts).where(inArray(accounts.workspaceId, WORKSPACES));
}

// Seed the FK targets directly through the drizzle schema: importing the
// accounts module's internals would violate the no-cross-module-internals
// architecture rule, and the spec only needs the rows to exist.
async function seedAccounts(db: DrizzleDb): Promise<void> {
  for (const ws of WORKSPACES) {
    for (const [suffix, id] of [
      ["src", ACCOUNTS[ws]!.source],
      ["dst", ACCOUNTS[ws]!.dest],
    ] as const) {
      await db.insert(accounts).values({
        id,
        workspaceId: ws,
        name: `Spec account ${ws}-${suffix}`,
        currency: "USD",
        kind: "bank",
        initialBalanceMinor: 0n,
      });
    }
  }
}

describe("DrizzleTransactionRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleTransactionRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
    await seedAccounts(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves and finds by id, including persisted revisions", async () => {
    const trx = makeTransaction({
      id: "tx-save-find",
      idempotencyKey: "idem-save-find",
      concept: "Save me",
    });
    const revised = unwrap(
      trx.revise({
        concept: "Save me — revised",
        revisedAt: new Date("2026-11-02T09:00:00Z"),
        revisedBy: "spec-user",
      }),
    );
    expect(revised.revisionNumber).toBe(1);
    await repository.save(trx);

    const found = await repository.findById(trx.workspaceId, trx.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(trx.id);
    expect(found!.workspaceId.value).toBe(WS_A);
    expect(found!.concept).toBe("Save me — revised");
    expect(found!.amount.minorUnits).toBe(1000n);
    expect(found!.amount.currency.code).toBe("USD");
    expect(found!.businessDate.isoDate).toBe("2026-11-01");
    expect(found!.category).toEqual({ kind: "uncategorized" });
    expect(found!.revisions).toHaveLength(1);
    expect(found!.revisions[0]!.revisionNumber).toBe(1);
    expect(found!.revisions[0]!.kind).toBe("revision");
    expect(found!.revisions[0]!.actor).toBe("spec-user");
    expect(found!.revisions[0]!.changes).toEqual([
      { field: "concept", previous: "Save me", next: "Save me — revised" },
    ]);
  });

  it("finds by idempotency key", async () => {
    const trx = makeTransaction({ idempotencyKey: "idem-key-1" });
    await repository.save(trx);

    const found = await repository.findByIdempotencyKey(
      trx.workspaceId,
      "idem-key-1",
    );
    expect(found?.id).toBe(trx.id);

    const missing = await repository.findByIdempotencyKey(
      trx.workspaceId,
      "no-such-key",
    );
    expect(missing).toBeNull();
  });

  it("returns revisions in revisionNumber order across saves and persists void status", async () => {
    const trx = makeTransaction({ id: "tx-revisions" });
    await repository.save(trx);

    unwrap(
      trx.revise({
        concept: "rev one",
        revisedAt: new Date("2026-11-02T10:00:00Z"),
        revisedBy: "spec-user",
      }),
    );
    await repository.save(trx);

    unwrap(
      trx.void({
        voidedAt: new Date("2026-11-03T10:00:00Z"),
        voidedBy: "spec-user",
      }),
    );
    await repository.save(trx);

    const found = await repository.findById(trx.workspaceId, trx.id);
    expect(found).not.toBeNull();
    expect(found!.status).toBe("voided");
    expect(found!.revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(found!.revisions.map((r) => r.kind)).toEqual(["revision", "void"]);
    expect(found!.revisions[1]!.changes).toEqual([
      { field: "status", previous: "confirmed", next: "voided" },
    ]);
  });

  it("lists with from/to inclusive on businessDate", async () => {
    const inside = makeTransaction({
      id: "tx-list-inside",
      businessDate: businessDate("2026-11-10"),
    });
    const edgeFrom = makeTransaction({
      id: "tx-list-edge-from",
      businessDate: businessDate("2026-11-01"),
    });
    const edgeTo = makeTransaction({
      id: "tx-list-edge-to",
      businessDate: businessDate("2026-11-30"),
    });
    const outside = makeTransaction({
      id: "tx-list-outside",
      businessDate: businessDate("2026-12-01"),
    });
    for (const t of [inside, edgeFrom, edgeTo, outside]) {
      await repository.save(t);
    }

    const rows = await repository.list(workspaceId(WS_A), {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(inside.id);
    expect(ids).toContain(edgeFrom.id);
    expect(ids).toContain(edgeTo.id);
    expect(ids).not.toContain(outside.id);
  });

  it("lists filtered by type", async () => {
    const income = makeTransaction({ id: "tx-list-income", type: "income" });
    const expense = makeTransaction({ id: "tx-list-expense", type: "expense" });
    await repository.save(income);
    await repository.save(expense);

    const rows = await repository.list(workspaceId(WS_A), { type: "income" });
    const mine = rows.filter((r) => [income.id, expense.id].includes(r.id));
    expect(mine.map((r) => r.id)).toEqual([income.id]);
  });

  it("lists filtered by category uncategorized vs categorized", async () => {
    const uncat = makeTransaction({
      id: "tx-list-uncat",
      category: "uncategorized",
    });
    const cat = makeTransaction({
      id: "tx-list-cat",
      category: "cat-groceries",
    });
    await repository.save(uncat);
    await repository.save(cat);

    const uncatRows = await repository.list(workspaceId(WS_A), {
      category: "uncategorized",
    });
    expect(uncatRows.map((r) => r.id)).toContain(uncat.id);
    expect(uncatRows.map((r) => r.id)).not.toContain(cat.id);
    expect(uncatRows.every((r) => r.category.kind === "uncategorized")).toBe(
      true,
    );

    const catRows = await repository.list(workspaceId(WS_A), {
      category: "cat-groceries",
    });
    expect(catRows.map((r) => r.id)).toContain(cat.id);
    expect(catRows.map((r) => r.id)).not.toContain(uncat.id);
  });

  it("lists filtered by q case-insensitively on concept", async () => {
    const match = makeTransaction({
      id: "tx-list-q-match",
      concept: "Weekly Groceries Market",
    });
    const other = makeTransaction({
      id: "tx-list-q-other",
      concept: "Pharmacy visit",
    });
    await repository.save(match);
    await repository.save(other);

    const rows = await repository.list(workspaceId(WS_A), { q: "groceries" });
    const mine = rows.filter((r) => [match.id, other.id].includes(r.id));
    expect(mine.map((r) => r.id)).toEqual([match.id]);
  });

  it("orders by businessDate desc then createdAt desc and applies limit/offset", async () => {
    const a = makeTransaction({
      id: "tx-list-order-a",
      businessDate: businessDate("2026-11-20"),
      concept: "order-check-aaa",
    });
    const b = makeTransaction({
      id: "tx-list-order-b",
      businessDate: businessDate("2026-11-20"),
      concept: "order-check-bbb",
    });
    const c = makeTransaction({
      id: "tx-list-order-c",
      businessDate: businessDate("2026-11-19"),
      concept: "order-check-ccc",
    });
    // Sequential saves keep createdAt strictly increasing (b after a);
    // ms-precision timestamps need a beat between inserts to stay ordered.
    await repository.save(a);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await repository.save(b);
    await repository.save(c);

    const ordered = await repository.list(workspaceId(WS_A), {
      q: "order-check",
    });
    const ids = ordered.map((r) => r.id);
    // businessDate desc: a,b (11-20) before c (11-19); b before a because
    // createdAt desc (b was inserted later).
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(c.id));
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(c.id));

    const page = await repository.list(workspaceId(WS_A), {
      q: "order-check",
      limit: 1,
      offset: 1,
    });
    expect(page.map((r) => r.id)).toEqual([a.id]);
  });

  it("scopes findById and list to the workspace", async () => {
    const trx = makeTransaction({ workspaceId: workspaceId(WS_A) });
    await repository.save(trx);

    const other = await repository.findById(workspaceId(WS_B), trx.id);
    expect(other).toBeNull();

    const listed = await repository.list(workspaceId(WS_B), {});
    expect(listed.map((r) => r.id)).not.toContain(trx.id);
  });

  it("does not duplicate revisions when saving the same state twice", async () => {
    const trx = makeTransaction({ id: "tx-idempotent-save" });
    unwrap(
      trx.revise({
        concept: "changed once",
        revisedAt: new Date("2026-11-02T10:00:00Z"),
        revisedBy: "spec-user",
      }),
    );
    await repository.save(trx);
    await repository.save(trx);

    const found = await repository.findById(trx.workspaceId, trx.id);
    expect(found!.revisions).toHaveLength(1);
  });
});
