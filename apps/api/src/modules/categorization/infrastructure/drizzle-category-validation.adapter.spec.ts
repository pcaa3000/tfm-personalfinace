import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { categories } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleCategoryValidationAdapter } from "./drizzle-category-validation.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-catval-a";
const WS_B = "drizzle-catval-b";
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

/**
 * Inserts a category row directly. `workspace` defaults to WS_A; pass
 * `null` for a global catalog row (tracked for cleanup).
 */
async function insertCategory(
  db: DrizzleDb,
  input: {
    key: string;
    workspace?: string | null;
    label?: string;
    nature?: string;
    archivedAt?: Date | null;
  },
): Promise<string> {
  const id = randomUUID();
  const workspace = input.workspace === undefined ? WS_A : input.workspace;
  await db.insert(categories).values({
    id,
    key: input.key,
    label: input.label ?? `Cat ${input.key}`,
    nature: input.nature ?? "essential",
    workspaceId: workspace,
    archivedAt: input.archivedAt ?? null,
  });
  if (workspace === null) {
    GLOBAL_IDS.push(id);
  }
  return id;
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

describe("DrizzleCategoryValidationAdapter (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const adapter = new DrizzleCategoryValidationAdapter(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  describe("existsForWorkspace", () => {
    it("accepts active owned and active global categories, rejects the rest", async () => {
      const ownedActive = await insertCategory(db, {
        key: "spec_val_owned_active",
      });
      const ownedArchived = await insertCategory(db, {
        key: "spec_val_owned_arch",
        archivedAt: new Date(),
      });
      const globalActive = await insertCategory(db, {
        key: "spec_val_global_active",
        workspace: null,
      });
      const globalArchived = await insertCategory(db, {
        key: "spec_val_global_arch",
        workspace: null,
        archivedAt: new Date(),
      });
      const foreign = await insertCategory(db, {
        key: "spec_val_foreign",
        workspace: WS_B,
      });

      const ws = workspaceId(WS_A);
      expect(await adapter.existsForWorkspace(ws, ownedActive)).toBe(true);
      expect(await adapter.existsForWorkspace(ws, globalActive)).toBe(true);
      expect(await adapter.existsForWorkspace(ws, ownedArchived)).toBe(false);
      expect(await adapter.existsForWorkspace(ws, globalArchived)).toBe(false);
      expect(await adapter.existsForWorkspace(ws, foreign)).toBe(false);
      expect(await adapter.existsForWorkspace(ws, "no-such-id")).toBe(false);
      // The foreign workspace does see its own row.
      expect(await adapter.existsForWorkspace(workspaceId(WS_B), foreign)).toBe(
        true,
      );
    });
  });

  describe("listForWorkspace", () => {
    it("lists active owned rows as custom and unshadowed globals as catalog", async () => {
      const globalId = await insertCategory(db, {
        key: "spec_val_list_global",
        workspace: null,
        label: "Global list",
      });
      const ownedId = await insertCategory(db, {
        key: "spec_val_list_owned",
        label: "Owned list",
      });

      const list = await adapter.listForWorkspace(workspaceId(WS_A));
      const global = list.find((c) => c.id === globalId);
      const owned = list.find((c) => c.id === ownedId);
      expect(global).toMatchObject({
        key: "spec_val_list_global",
        custom: false,
      });
      expect(owned).toMatchObject({
        key: "spec_val_list_owned",
        label: "Owned list",
        custom: true,
      });
    });

    it("hides a global shadowed by an active workspace copy with the same key", async () => {
      const globalId = await insertCategory(db, {
        key: "spec_val_shadow",
        workspace: null,
      });
      const ownedId = await insertCategory(db, { key: "spec_val_shadow" });

      const list = await adapter.listForWorkspace(workspaceId(WS_A));
      const rows = list.filter((c) => c.key === "spec_val_shadow");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(ownedId);
      expect(rows[0]!.custom).toBe(true);
      expect(list.some((c) => c.id === globalId)).toBe(false);
    });

    it("hides a global even when the shadowing workspace copy is archived", async () => {
      const globalId = await insertCategory(db, {
        key: "spec_val_shadow_arch",
        workspace: null,
      });
      await insertCategory(db, {
        key: "spec_val_shadow_arch",
        archivedAt: new Date(),
      });

      const list = await adapter.listForWorkspace(workspaceId(WS_A));
      // The archived copy still shadows: neither row is listed.
      expect(list.some((c) => c.id === globalId)).toBe(false);
      expect(list.some((c) => c.key === "spec_val_shadow_arch")).toBe(false);
    });

    it("does not list categories owned by other workspaces and sorts by key", async () => {
      await insertCategory(db, {
        key: "spec_val_foreign_list",
        workspace: WS_B,
      });
      await insertCategory(db, { key: "spec_val_ord_b" });
      await insertCategory(db, { key: "spec_val_ord_a" });

      const list = await adapter.listForWorkspace(workspaceId(WS_A));
      expect(list.some((c) => c.key === "spec_val_foreign_list")).toBe(false);

      const keys = list.map((c) => c.key);
      const idxA = keys.indexOf("spec_val_ord_a");
      const idxB = keys.indexOf("spec_val_ord_b");
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeGreaterThanOrEqual(0);
      expect(idxA).toBeLessThan(idxB);
    });
  });
});
