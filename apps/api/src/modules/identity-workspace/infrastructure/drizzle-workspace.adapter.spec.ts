import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../../../drizzle/db.js";
import { workspaces } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import type { CategoryCatalogProvisionerPort } from "../application/category-catalog-provisioner.port.js";
import type { WorkspaceCatalogProvisionerPort } from "../application/workspace-catalog-provisioner.port.js";
import { DrizzleWorkspaceAdapter } from "./drizzle-workspace.adapter.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const ISSUER = "drizzle-ws-spec";
const SUBJECTS = ["alice", "bob", "carol", "dave", "erin"] as const;
const IDENTITY_KEYS = SUBJECTS.map((s) => `${ISSUER}|${s}`);

function caller(subject: string): { issuer: string; subject: string } {
  return { issuer: ISSUER, subject };
}

function identityKey(subject: string): string {
  return `${ISSUER}|${subject}`;
}

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

function makeProvisioners() {
  const catalog: WorkspaceCatalogProvisionerPort = {
    ensureDefaultCurrency: vi.fn(async () => {}),
  };
  const seeds: CategoryCatalogProvisionerPort = {
    ensureSeedCategories: vi.fn(async () => {}),
  };
  return { catalog, seeds };
}

function makeAdapter(db: DrizzleDb) {
  const { catalog, seeds } = makeProvisioners();
  return {
    adapter: new DrizzleWorkspaceAdapter(
      db,
      () => catalog,
      () => seeds,
    ),
    catalog,
    seeds,
  };
}

async function cleanupAll(db: DrizzleDb): Promise<void> {
  await db.delete(workspaces).where(inArray(workspaces.identityKey, IDENTITY_KEYS));
}

describe("DrizzleWorkspaceAdapter (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("resolve creates the workspace with deterministic defaults and provisions the catalogs", async () => {
    const { adapter, catalog, seeds } = makeAdapter(db);

    const context = await adapter.resolve(caller("alice"));

    expect(context.locale).toBe("en-US");
    expect(context.timezone).toBe("UTC");
    expect(context.defaultCurrency).toBe("PEN");

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, identityKey("alice")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("personal");
    expect(rows[0]!.id).toBe(context.workspaceId.value);

    expect(catalog.ensureDefaultCurrency).toHaveBeenCalledTimes(1);
    const [wsArg, codeArg] = vi.mocked(catalog.ensureDefaultCurrency).mock
      .calls[0]!;
    expect(wsArg.value).toBe(context.workspaceId.value);
    expect(codeArg).toBe("PEN");
    expect(seeds.ensureSeedCategories).toHaveBeenCalledTimes(1);
  });

  it("resolve is idempotent: a second call returns the same workspace without re-provisioning", async () => {
    const { adapter, catalog, seeds } = makeAdapter(db);

    const first = await adapter.resolve(caller("bob"));
    const second = await adapter.resolve(caller("bob"));

    expect(second.workspaceId.value).toBe(first.workspaceId.value);
    expect(second.locale).toBe(first.locale);
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, identityKey("bob")));
    expect(rows).toHaveLength(1);
    expect(catalog.ensureDefaultCurrency).toHaveBeenCalledTimes(1);
    expect(seeds.ensureSeedCategories).toHaveBeenCalledTimes(1);
  });

  it("a new adapter instance resolves the already-created row (no re-provisioning)", async () => {
    const { adapter: first } = makeAdapter(db);
    const created = await first.resolve(caller("carol"));

    const { adapter: restarted, catalog, seeds } = makeAdapter(db);
    const resolved = await restarted.resolve(caller("carol"));

    expect(resolved.workspaceId.value).toBe(created.workspaceId.value);
    expect(catalog.ensureDefaultCurrency).not.toHaveBeenCalled();
    expect(seeds.ensureSeedCategories).not.toHaveBeenCalled();
  });

  it("resolves different callers to different workspaces", async () => {
    const { adapter } = makeAdapter(db);

    const a = await adapter.resolve(caller("alice"));
    const d = await adapter.resolve(caller("dave"));

    expect(a.workspaceId.value).not.toBe(d.workspaceId.value);
  });

  it("updatePreferences persists a partial patch and returns the updated context", async () => {
    const { adapter } = makeAdapter(db);
    const context = await adapter.resolve(caller("carol"));

    const updated = await adapter.updatePreferences(context.workspaceId, {
      locale: "es-PE",
      timezone: "America/Lima",
    });
    expect(updated.workspaceId.value).toBe(context.workspaceId.value);
    expect(updated.locale).toBe("es-PE");
    expect(updated.timezone).toBe("America/Lima");
    // Untouched fields keep their values.
    expect(updated.defaultCurrency).toBe("PEN");

    const [row] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, context.workspaceId.value));
    expect(row!.locale).toBe("es-PE");
    expect(row!.timezone).toBe("America/Lima");
    expect(row!.defaultCurrency).toBe("PEN");

    // A later resolve observes the persisted preferences.
    const again = await adapter.resolve(caller("carol"));
    expect(again.locale).toBe("es-PE");
    expect(again.timezone).toBe("America/Lima");
  });

  it("updatePreferences with an empty patch returns the row unchanged", async () => {
    const { adapter } = makeAdapter(db);
    const context = await adapter.resolve(caller("dave"));

    const updated = await adapter.updatePreferences(context.workspaceId, {});

    expect(updated.workspaceId.value).toBe(context.workspaceId.value);
    expect(updated.locale).toBe(context.locale);
    expect(updated.timezone).toBe(context.timezone);
    expect(updated.defaultCurrency).toBe(context.defaultCurrency);
  });

  it("updatePreferences on an unknown workspace throws", async () => {
    const { adapter } = makeAdapter(db);

    await expect(
      adapter.updatePreferences(workspaceId(`${ISSUER}|ghost`), {
        locale: "fr-FR",
      }),
    ).rejects.toThrow();
  });

  it("rolls back the workspace insert when a provisioner fails (atomic provisioning, S1)", async () => {
    const failingCatalog: WorkspaceCatalogProvisionerPort = {
      ensureDefaultCurrency: vi.fn(async () => {
        throw new Error("catalog down");
      }),
    };
    const adapter = new DrizzleWorkspaceAdapter(db, () => failingCatalog, undefined);

    await expect(adapter.resolve(caller("erin"))).rejects.toThrow(
      "catalog down",
    );

    // No orphan row: the whole create+provision unit rolled back.
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, identityKey("erin")));
    expect(rows).toHaveLength(0);
    expect(failingCatalog.ensureDefaultCurrency).toHaveBeenCalled();
  });
});
