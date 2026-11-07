import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { currencies } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import { DrizzleCurrencyRepository } from "./drizzle-currency.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

// One workspace per test keeps listActive/countActive assertions exact.
const WS = {
  roundtrip: "drizzle-currepo-roundtrip",
  revise: "drizzle-currepo-revise",
  archive: "drizzle-currepo-archive",
  scope: "drizzle-currepo-scope",
  seed: "drizzle-currepo-seed",
  updatedAt: "drizzle-currepo-updatedat",
} as const;
const WS_OTHER = "drizzle-currepo-other";
const WORKSPACES = [...Object.values(WS), WS_OTHER];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

function makeCurrency(input: {
  id: string;
  workspace: string;
  code: string;
}): WorkspaceCurrency {
  const currency = WorkspaceCurrency.create({
    id: input.id,
    workspaceId: workspaceId(input.workspace),
    code: input.code,
  });
  if (!currency.ok) {
    throw currency.error;
  }
  return currency.value;
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db
    .delete(currencies)
    .where(inArray(currencies.workspaceId, WORKSPACES));
}

describe("DrizzleCurrencyRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleCurrencyRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves and lists active currencies ordered by code", async () => {
    const ws = workspaceId(WS.roundtrip);
    const usd = makeCurrency({
      id: "cur-spec-usd",
      workspace: WS.roundtrip,
      code: "USD",
    });
    const eur = makeCurrency({
      id: "cur-spec-eur",
      workspace: WS.roundtrip,
      code: "EUR",
    });
    await repository.save(usd);
    await repository.save(eur);

    const list = await repository.listActive(ws);
    expect(list.map((c) => c.code.code)).toEqual(["EUR", "USD"]);

    const found = await repository.findActiveById(ws, usd.id);
    expect(found).not.toBeNull();
    expect(found!.code.code).toBe("USD");
    expect(found!.workspaceId.value).toBe(WS.roundtrip);
    expect(found!.archivedAt).toBeNull();

    expect(await repository.findActiveById(ws, "no-such")).toBeNull();
    expect(await repository.findActiveById(workspaceId(WS_OTHER), usd.id)).toBeNull();
  });

  it("updates code on re-save (upsert by id)", async () => {
    const ws = workspaceId(WS.revise);
    const currency = makeCurrency({
      id: "cur-spec-revise",
      workspace: WS.revise,
      code: "AUD",
    });
    await repository.save(currency);

    const change = currency.changeCode("CAD");
    expect(change.ok).toBe(true);
    await repository.save(currency);

    const found = await repository.findActiveById(ws, currency.id);
    expect(found!.code.code).toBe("CAD");
    expect(await repository.existsCode(ws, "AUD")).toBe(false);
    expect(await repository.existsCode(ws, "CAD")).toBe(true);
  });

  it("archive excludes from active reads but keeps the code reserved", async () => {
    const ws = workspaceId(WS.archive);
    const currency = makeCurrency({
      id: "cur-spec-archive",
      workspace: WS.archive,
      code: "CHF",
    });
    await repository.save(currency);

    const archived = currency.archive();
    expect(archived.ok).toBe(true);
    await repository.save(currency);

    expect(await repository.findActiveById(ws, currency.id)).toBeNull();
    expect(await repository.listActive(ws)).toHaveLength(0);
    expect(await repository.existsCode(ws, "CHF")).toBe(true);
    expect(await repository.countActive(ws)).toBe(0);
    expect(await repository.isEnabled(ws, "CHF")).toBe(false);
  });

  it("scopes every read to the owning workspace", async () => {
    const ws = workspaceId(WS.scope);
    const other = workspaceId(WS_OTHER);
    const currency = makeCurrency({
      id: "cur-spec-scope",
      workspace: WS.scope,
      code: "NZD",
    });
    await repository.save(currency);

    expect(await repository.existsCode(other, "NZD")).toBe(false);
    expect(await repository.isEnabled(other, "NZD")).toBe(false);
    expect(await repository.findActiveById(other, currency.id)).toBeNull();
    expect(await repository.listActive(other)).toHaveLength(0);
    expect(await repository.countActive(other)).toBe(0);

    // The owner sees it.
    expect(await repository.isEnabled(ws, "NZD")).toBe(true);
    expect(await repository.countActive(ws)).toBe(1);
    expect(await repository.existsCode(ws, "NZD")).toBe(true);
  });

  it("ensureDefaultCurrency seeds the default code idempotently and never revives archived rows", async () => {
    const ws = workspaceId(WS.seed);
    await repository.ensureDefaultCurrency(ws, "PEN");

    let list = await repository.listActive(ws);
    expect(list.map((c) => c.code.code)).toEqual(["PEN"]);

    // Second call is a no-op upsert on (workspaceId, code).
    await repository.ensureDefaultCurrency(ws, "PEN");
    list = await repository.listActive(ws);
    expect(list).toHaveLength(1);

    // Archiving the seeded row then re-ensuring must NOT unarchive it —
    // the prisma upsert uses `update: {}`, which leaves archivedAt alone.
    const seeded = list[0]!;
    const archived = seeded.archive();
    expect(archived.ok).toBe(true);
    await repository.save(seeded);
    await repository.ensureDefaultCurrency(ws, "PEN");

    expect(await repository.findActiveById(ws, seeded.id)).toBeNull();
    expect(await repository.existsCode(ws, "PEN")).toBe(true);
    expect(await repository.listActive(ws)).toHaveLength(0);
  });

  it("bumps updatedAt on update paths (prisma @updatedAt equivalent)", async () => {
    const currency = makeCurrency({
      id: "cur-spec-updatedat",
      workspace: WS.updatedAt,
      code: "MXN",
    });
    await repository.save(currency);

    const [before] = await db
      .select({ updatedAt: currencies.updatedAt })
      .from(currencies)
      .where(eq(currencies.id, currency.id));
    expect(before!.updatedAt).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const change = currency.changeCode("MYR");
    expect(change.ok).toBe(true);
    await repository.save(currency);

    const [after] = await db
      .select({ updatedAt: currencies.updatedAt })
      .from(currencies)
      .where(eq(currencies.id, currency.id));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
  });
});
