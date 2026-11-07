import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { categories } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { Category } from "../domain/category.js";
import { DrizzleCategoryRepository } from "./drizzle-category.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-catrepo-a";
const WS_B = "drizzle-catrepo-b";
const WORKSPACES = [WS_A, WS_B];

/** Ids of the global fixture rows this spec inserts (removed on cleanup). */
const GLOBAL_IDS: string[] = [];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

function makeCategory(input: {
  id: string;
  key: string;
  label?: string;
  nature?: string;
  workspace?: string;
}): Category {
  const category = Category.createCustom({
    id: input.id,
    workspaceId: workspaceId(input.workspace ?? WS_A),
    key: input.key,
    label: input.label ?? `Label ${input.key}`,
    nature: input.nature ?? "essential",
  });
  if (!category.ok) {
    throw category.error;
  }
  return category.value;
}

/**
 * Inserts a global catalog row (workspaceId NULL) directly — the domain
 * aggregate only models workspace-owned categories.
 */
async function insertGlobal(
  db: DrizzleDb,
  input: {
    key: string;
    label?: string;
    nature?: string;
    archivedAt?: Date | null;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(categories).values({
    id,
    key: input.key,
    label: input.label ?? `Global ${input.key}`,
    nature: input.nature ?? "essential",
    workspaceId: null,
    archivedAt: input.archivedAt ?? null,
  });
  GLOBAL_IDS.push(id);
  return id;
}

async function ownedRows(db: DrizzleDb, workspace: string, key: string) {
  return db
    .select()
    .from(categories)
    .where(
      and(eq(categories.workspaceId, workspace), eq(categories.key, key)),
    );
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db
    .delete(categories)
    .where(inArray(categories.workspaceId, WORKSPACES));
  if (GLOBAL_IDS.length > 0) {
    await db.delete(categories).where(inArray(categories.id, GLOBAL_IDS));
    GLOBAL_IDS.length = 0;
  }
}

describe("DrizzleCategoryRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleCategoryRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves and finds an owned category; revise persists mutable fields", async () => {
    const category = makeCategory({
      id: "cat-spec-roundtrip",
      key: "spec_roundtrip",
      label: "Original",
      nature: "essential",
    });
    await repository.save(category);

    const found = await repository.findOwnedById(
      category.workspaceId,
      category.id,
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe(category.id);
    expect(found!.key).toBe("spec_roundtrip");
    expect(found!.label).toBe("Original");
    expect(found!.nature).toBe("essential");
    expect(found!.workspaceId.value).toBe(WS_A);

    const revised = makeCategory({
      id: category.id,
      key: "spec_roundtrip",
      label: "Original",
    });
    const revision = revised.revise({
      label: "Renamed",
      nature: "discretionary",
    });
    expect(revision.ok).toBe(true);
    await repository.save(revised);

    const after = await repository.findOwnedById(
      category.workspaceId,
      category.id,
    );
    expect(after!.label).toBe("Renamed");
    expect(after!.nature).toBe("discretionary");
    // key and workspace are not part of the upsert update set
    // (mirrors the prisma repo: only label/nature/archivedAt change).
    expect(after!.key).toBe("spec_roundtrip");
    expect(after!.workspaceId.value).toBe(WS_A);
  });

  it("excludes archived categories from findOwnedById but keeps the key reserved", async () => {
    const category = makeCategory({
      id: "cat-spec-archive",
      key: "spec_archive",
    });
    await repository.save(category);
    category.archive();
    await repository.save(category);

    expect(
      await repository.findOwnedById(category.workspaceId, category.id),
    ).toBeNull();
    // existsKey counts archived rows too (the unique index reserves them).
    expect(
      await repository.existsKey(category.workspaceId, "spec_archive"),
    ).toBe(true);
  });

  it("findOwnedById only resolves active rows owned by the workspace", async () => {
    const globalId = await insertGlobal(db, { key: "spec_global_only" });
    const owned = makeCategory({ id: "cat-spec-scope", key: "spec_scope" });
    await repository.save(owned);

    // Global catalog rows are never "owned".
    expect(
      await repository.findOwnedById(workspaceId(WS_A), globalId),
    ).toBeNull();
    // Other workspaces cannot see the row.
    expect(
      await repository.findOwnedById(workspaceId(WS_B), owned.id),
    ).toBeNull();
    // Unknown id.
    expect(
      await repository.findOwnedById(workspaceId(WS_A), "no-such-id"),
    ).toBeNull();
    // Sanity: the owner does see it.
    expect(
      await repository.findOwnedById(workspaceId(WS_A), owned.id),
    ).not.toBeNull();
  });

  it("existsKey is scoped to the workspace and counts archived rows", async () => {
    await insertGlobal(db, { key: "spec_global_key" });
    const owned = makeCategory({ id: "cat-spec-key", key: "spec_owned_key" });
    await repository.save(owned);

    expect(
      await repository.existsKey(workspaceId(WS_A), "spec_owned_key"),
    ).toBe(true);
    expect(
      await repository.existsKey(workspaceId(WS_B), "spec_owned_key"),
    ).toBe(false);
    // A global-only key does not count as owned.
    expect(
      await repository.existsKey(workspaceId(WS_A), "spec_global_key"),
    ).toBe(false);
    expect(
      await repository.existsKey(workspaceId(WS_A), "spec_missing_key"),
    ).toBe(false);

    owned.archive();
    await repository.save(owned);
    expect(
      await repository.existsKey(workspaceId(WS_A), "spec_owned_key"),
    ).toBe(true);
  });

  it("ensureSeedCategories copies active globals preserving key/label/nature", async () => {
    const g1 = await insertGlobal(db, {
      key: "spec_seed_one",
      label: "Semilla uno",
      nature: "income",
    });
    const g2 = await insertGlobal(db, {
      key: "spec_seed_two",
      label: "Semilla dos",
      nature: "discretionary",
    });

    await repository.ensureSeedCategories(workspaceId(WS_A));

    const one = await ownedRows(db, WS_A, "spec_seed_one");
    expect(one).toHaveLength(1);
    expect(one[0]!.label).toBe("Semilla uno");
    expect(one[0]!.nature).toBe("income");
    expect(one[0]!.workspaceId).toBe(WS_A);
    expect(one[0]!.archivedAt).toBeNull();

    const two = await ownedRows(db, WS_A, "spec_seed_two");
    expect(two).toHaveLength(1);
    expect(two[0]!.label).toBe("Semilla dos");
    expect(two[0]!.nature).toBe("discretionary");

    // Copies land only in the target workspace; globals stay global.
    expect(await ownedRows(db, WS_B, "spec_seed_one")).toHaveLength(0);
    const [globalRow] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, g1));
    expect(globalRow!.workspaceId).toBeNull();
    const [globalRow2] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, g2));
    expect(globalRow2!.workspaceId).toBeNull();
  });

  it("ensureSeedCategories skips the uncategorized fallback (key or nature) and archived globals", async () => {
    await insertGlobal(db, {
      key: "uncategorized",
      label: "Sin categorizar",
      nature: "essential",
    });
    await insertGlobal(db, { key: "spec_seed_nature", nature: "uncategorized" });
    await insertGlobal(db, {
      key: "spec_seed_archived",
      archivedAt: new Date(),
    });

    await repository.ensureSeedCategories(workspaceId(WS_A));

    expect(await ownedRows(db, WS_A, "uncategorized")).toHaveLength(0);
    expect(await ownedRows(db, WS_A, "spec_seed_nature")).toHaveLength(0);
    expect(await ownedRows(db, WS_A, "spec_seed_archived")).toHaveLength(0);
  });

  it("ensureSeedCategories skips keys the workspace already owns", async () => {
    await insertGlobal(db, { key: "spec_seed_dup", label: "Global dup" });
    const owned = makeCategory({
      id: "cat-spec-seeddup",
      key: "spec_seed_dup",
    });
    await repository.save(owned);

    await repository.ensureSeedCategories(workspaceId(WS_A));

    const rows = await ownedRows(db, WS_A, "spec_seed_dup");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(owned.id);
  });

  it("ensureSeedCategories is idempotent", async () => {
    await insertGlobal(db, { key: "spec_seed_idem" });

    await repository.ensureSeedCategories(workspaceId(WS_A));
    await repository.ensureSeedCategories(workspaceId(WS_A));

    expect(await ownedRows(db, WS_A, "spec_seed_idem")).toHaveLength(1);
  });
});
