import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { accounts } from "../../../drizzle/schema.js";
import {
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../shared-kernel/index.js";
import { Account } from "../domain/account.js";
import { DrizzleAccountRepository } from "./drizzle-account.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-acc-spec-a";
const WS_B = "drizzle-acc-spec-b";
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

function makeAccount(input: {
  id: string;
  workspaceId?: WorkspaceId;
  name: string;
  currency?: string;
  kind?: string;
  initialBalance?: Money;
}): Account {
  return unwrap(
    Account.create({
      id: input.id,
      workspaceId: input.workspaceId ?? workspaceId(WS_A),
      name: input.name,
      currency: input.currency ?? "USD",
      kind: input.kind ?? "bank",
      ...(input.initialBalance !== undefined
        ? { initialBalance: input.initialBalance }
        : {}),
    }),
  );
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db.delete(accounts).where(inArray(accounts.workspaceId, WORKSPACES));
}

describe("DrizzleAccountRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleAccountRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves and finds by id", async () => {
    const account = makeAccount({
      id: "acc-save-find",
      name: "BCP soles",
      currency: "USD",
      kind: "bank",
      initialBalance: unwrap(Money.create("1500.00", "USD")),
    });
    await repository.save(account);

    const found = await repository.findById(account.workspaceId, account.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(account.id);
    expect(found!.name).toBe("BCP soles");
    expect(found!.kind).toBe("bank");
    expect(found!.currency.code).toBe("USD");
    expect(found!.initialBalance.minorUnits).toBe(150000n);
    expect(found!.archivedAt).toBeNull();
    expect(found!.workspaceId.value).toBe(WS_A);
  });

  it("lists only active accounts ordered by createdAt asc", async () => {
    const first = makeAccount({ id: "acc-list-1", name: "Wallet cash", kind: "cash" });
    const second = makeAccount({ id: "acc-list-2", name: "Savings USD", kind: "savings" });
    await repository.save(first);
    // createdAt has ms precision — separate the inserts so ordering is
    // deterministic (first must precede second).
    await new Promise((resolve) => setTimeout(resolve, 10));
    await repository.save(second);

    const rows = await repository.list(workspaceId(WS_A));
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("excludes archived accounts from list, findById and accountCurrency", async () => {
    const account = makeAccount({ id: "acc-archive", name: "To archive" });
    await repository.save(account);

    unwrap(account.archive());
    await repository.save(account);

    const listed = await repository.list(workspaceId(WS_A));
    expect(listed.map((r) => r.id)).not.toContain(account.id);

    const found = await repository.findById(account.workspaceId, account.id);
    expect(found).toBeNull();

    const currency = await repository.accountCurrency(
      account.workspaceId,
      account.id,
    );
    expect(currency).toBeNull();
  });

  it("returns accountCurrency for an active account and null for unknown/other-workspace ids", async () => {
    const account = makeAccount({
      id: "acc-currency",
      name: "EUR account",
      currency: "EUR",
    });
    await repository.save(account);

    expect(await repository.accountCurrency(account.workspaceId, account.id)).toBe(
      "EUR",
    );
    expect(await repository.accountCurrency(account.workspaceId, "no-such")).toBeNull();
    expect(
      await repository.accountCurrency(workspaceId(WS_B), account.id),
    ).toBeNull();
  });

  it("updates mutable fields on re-save (upsert by id)", async () => {
    const account = makeAccount({ id: "acc-update", name: "Old name", kind: "bank" });
    await repository.save(account);

    unwrap(account.revise({ name: "New name", kind: "savings" }));
    await repository.save(account);

    const found = await repository.findById(account.workspaceId, account.id);
    expect(found!.name).toBe("New name");
    expect(found!.kind).toBe("savings");
  });

  it("scopes findById and list to the workspace", async () => {
    const account = makeAccount({ id: "acc-scope", name: "Scoped account" });
    await repository.save(account);

    expect(await repository.findById(workspaceId(WS_B), account.id)).toBeNull();
    const listed = await repository.list(workspaceId(WS_B));
    expect(listed.map((r) => r.id)).not.toContain(account.id);
  });
});

describe("includeArchived (T25)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);

  afterAll(async () => {
    await db
      .delete(accounts)
      .where(inArray(accounts.workspaceId, WORKSPACES));
    await pool.end();
  });

  it("list returns archived rows only when includeArchived is set", async () => {
    const repo = new DrizzleAccountRepository(db);
    const ws = workspaceId(WS_A);
    const active = makeAccount({ id: "t25-active", name: "Activa" });
    const archived = makeAccount({ id: "t25-archived", name: "Archivada" });
    await repo.save(active);
    await repo.save(archived);
    archived.archive();
    await repo.save(archived);

    const activeOnly = await repo.list(ws);
    const all = await repo.list(ws, { includeArchived: true });

    expect(activeOnly.map((a) => a.id)).toEqual(["t25-active"]);
    expect(all.map((a) => a.id).sort()).toEqual([
      "t25-active",
      "t25-archived",
    ]);
  });

  it("findById returns the archived row when includeArchived is set", async () => {
    const repo = new DrizzleAccountRepository(db);
    const ws = workspaceId(WS_A);
    const archived = makeAccount({ id: "t25-find", name: "Para buscar" });
    await repo.save(archived);
    archived.archive();
    await repo.save(archived);

    expect(await repo.findById(ws, "t25-find")).toBeNull();
    const found = await repo.findById(ws, "t25-find", {
      includeArchived: true,
    });
    expect(found?.id).toBe("t25-find");
    expect(found?.archivedAt).not.toBeNull();
  });
});
