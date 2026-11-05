import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { PrismaCategoryRepository } from "./prisma-category.repository.js";

interface GlobalCategoryRow {
  id: string;
  key: string;
  label: string;
  nature: string;
}

function workspaceId(value = "ws-1"): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) {
    throw id.error;
  }
  return id.value;
}

/**
 * In-memory stand-in for the two reads and one bulk insert the
 * provisioner performs against `categorization_categories`.
 */
function makePrisma({
  globals,
  ownedKeys,
}: {
  globals: GlobalCategoryRow[];
  ownedKeys: string[];
}) {
  const findMany = vi.fn(
    async (args: {
      where: { workspaceId?: string | null };
      select?: Record<string, boolean>;
    }) =>
      args.where.workspaceId === null
        ? globals
        : ownedKeys.map((key) => ({ key })),
  );
  const createMany = vi.fn(async () => ({ count: 0 }));
  const category = { findMany, createMany };
  return {
    category,
    prisma: { category } as unknown as PrismaClient,
  };
}

describe("PrismaCategoryRepository.ensureSeedCategories (T19)", () => {
  it("copies every active global category into the workspace preserving key/label/nature", async () => {
    const { prisma, category } = makePrisma({
      globals: [
        { id: "g-food", key: "food", label: "Comida", nature: "essential" },
        { id: "g-salary", key: "salary", label: "Sueldo", nature: "income" },
      ],
      ownedKeys: [],
    });
    const repository = new PrismaCategoryRepository(prisma);

    await repository.ensureSeedCategories(workspaceId());

    expect(category.createMany).toHaveBeenCalledWith({
      data: [
        {
          key: "food",
          label: "Comida",
          nature: "essential",
          workspaceId: "ws-1",
        },
        {
          key: "salary",
          label: "Sueldo",
          nature: "income",
          workspaceId: "ws-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("never copies the system uncategorized fallback (key or nature)", async () => {
    const { prisma, category } = makePrisma({
      globals: [
        {
          id: "g-uncat",
          key: "uncategorized",
          label: "Sin categorizar",
          nature: "uncategorized",
        },
        {
          id: "g-uncat-legacy",
          key: "legacy_sin_categoria",
          label: "Legacy",
          nature: "uncategorized",
        },
        { id: "g-food", key: "food", label: "Comida", nature: "essential" },
      ],
      ownedKeys: [],
    });
    const repository = new PrismaCategoryRepository(prisma);

    await repository.ensureSeedCategories(workspaceId());

    expect(category.createMany).toHaveBeenCalledWith({
      data: [
        {
          key: "food",
          label: "Comida",
          nature: "essential",
          workspaceId: "ws-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("skips keys the workspace already owns (any archivedAt)", async () => {
    const { prisma, category } = makePrisma({
      globals: [
        { id: "g-food", key: "food", label: "Comida", nature: "essential" },
        { id: "g-home", key: "home", label: "Hogar", nature: "essential" },
      ],
      // "food" is already owned — even if that copy is archived its key
      // stays reserved by @@unique([key, workspaceId]).
      ownedKeys: ["food"],
    });
    const repository = new PrismaCategoryRepository(prisma);

    await repository.ensureSeedCategories(workspaceId());

    // The ownership check must not filter archivedAt: an archived copy
    // still shadows and reserves the key.
    expect(category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
    expect(category.createMany).toHaveBeenCalledWith({
      data: [
        {
          key: "home",
          label: "Hogar",
          nature: "essential",
          workspaceId: "ws-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("is idempotent: a second provisioning inserts nothing", async () => {
    const { prisma, category } = makePrisma({
      globals: [
        { id: "g-food", key: "food", label: "Comida", nature: "essential" },
      ],
      ownedKeys: ["food"],
    });
    const repository = new PrismaCategoryRepository(prisma);

    await repository.ensureSeedCategories(workspaceId());

    expect(category.createMany).not.toHaveBeenCalled();
  });
});
