import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PrismaCategoryValidationAdapter } from "./prisma-category-validation.adapter.js";

interface CategoryRow {
  id: string;
  key: string;
  label: string;
  nature: string;
  workspaceId: string | null;
  archivedAt: Date | null;
}

function workspaceId(value = "ws-1"): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

const globalFood: CategoryRow = {
  id: "g-food",
  key: "food",
  label: "Comida",
  nature: "essential",
  workspaceId: null,
  archivedAt: null,
};

const globalHome: CategoryRow = {
  id: "g-home",
  key: "home",
  label: "Hogar",
  nature: "essential",
  workspaceId: null,
  archivedAt: null,
};

/**
 * In-memory double for the two reads listForWorkspace performs: the
 * active rows visible to the workspace (OR filter) and the keys the
 * workspace owns regardless of archivedAt (shadowing rule, T19).
 */
function makePrisma({
  activeRows,
  ownedKeys,
}: {
  activeRows: CategoryRow[];
  ownedKeys: string[];
}) {
  const findMany = vi.fn(
    async (args: {
      where: {
        workspaceId?: string | null;
        OR?: unknown[];
        archivedAt?: unknown;
      };
    }) =>
      "OR" in args.where
        ? activeRows
        : ownedKeys.map((key) => ({ key })),
  );
  const category = { findMany };
  return {
    category,
    prisma: { category } as unknown as PrismaClient,
  };
}

describe("PrismaCategoryValidationAdapter.listForWorkspace (T19)", () => {
  it("returns active workspace copies as custom and unshadowed globals as catalog", async () => {
    const wsCopy: CategoryRow = {
      id: "ws-pets",
      key: "pets",
      label: "Mascotas",
      nature: "discretionary",
      workspaceId: "ws-1",
      archivedAt: null,
    };
    const { prisma } = makePrisma({
      activeRows: [globalHome, wsCopy],
      ownedKeys: ["pets"],
    });
    const adapter = new PrismaCategoryValidationAdapter(prisma);

    const list = await adapter.listForWorkspace(workspaceId());

    expect(list).toEqual([
      { id: "g-home", key: "home", label: "Hogar", nature: "essential", custom: false },
      {
        id: "ws-pets",
        key: "pets",
        label: "Mascotas",
        nature: "discretionary",
        custom: true,
      },
    ]);
  });

  it("hides a global whose key is shadowed by an active workspace copy", async () => {
    const wsFood: CategoryRow = {
      id: "ws-food",
      key: "food",
      label: "Comida",
      nature: "essential",
      workspaceId: "ws-1",
      archivedAt: null,
    };
    const { prisma } = makePrisma({
      activeRows: [globalFood, globalHome, wsFood],
      ownedKeys: ["food"],
    });
    const adapter = new PrismaCategoryValidationAdapter(prisma);

    const list = await adapter.listForWorkspace(workspaceId());

    expect(list.map((row) => row.id)).toEqual(["g-home", "ws-food"]);
  });

  it("hides a global even when the workspace copy that shadows it is archived", async () => {
    const { prisma, category } = makePrisma({
      // The ws-owned "food" is archived, so only the globals survive
      // the active-rows read — but the global must not reappear.
      activeRows: [globalFood, globalHome],
      ownedKeys: ["food"],
    });
    const adapter = new PrismaCategoryValidationAdapter(prisma);

    const list = await adapter.listForWorkspace(workspaceId());

    // The owned-keys read must not filter archivedAt.
    expect(category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
    expect(list.map((row) => row.key)).toEqual(["home"]);
  });
});
