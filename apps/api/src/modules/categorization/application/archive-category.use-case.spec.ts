import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Category } from "../domain/category.js";
import type { CategoryRepositoryPort } from "./ports/category-repository.port.js";
import { ArchiveCategoryUseCase } from "./archive-category.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function storedCategory(): Category {
  const created = Category.createCustom({
    id: "cat-1",
    workspaceId: ws,
    key: "pets",
    label: "Mascotas",
    nature: "discretionary",
  });
  if (!created.ok) throw new Error("setup failed");
  return created.value;
}

class InMemoryCategories implements CategoryRepositoryPort {
  saved: Category[] = [];

  constructor(private readonly stored: Category | null) {}

  async save(category: Category) {
    this.saved.push(category);
  }
  async findOwnedById(_workspaceId: WorkspaceId, _id: string) {
    return this.stored;
  }
  async existsKey(_workspaceId: WorkspaceId, _key: string) {
    return false;
  }
}

describe("ArchiveCategoryUseCase (RF-044)", () => {
  it("marks the workspace category as archived", async () => {
    const stored = storedCategory();
    const repo = new InMemoryCategories(stored);
    const useCase = new ArchiveCategoryUseCase(repo);

    const result = await useCase.execute({
      workspaceId: ws,
      categoryId: "cat-1",
    });

    expect(result.ok).toBe(true);
    expect(stored.archivedAt).toBeInstanceOf(Date);
    expect(repo.saved).toHaveLength(1);
  });

  it("returns CATEGORY_NOT_FOUND for unknown, global, archived or foreign categories", async () => {
    const repo = new InMemoryCategories(null);
    const useCase = new ArchiveCategoryUseCase(repo);

    const result = await useCase.execute({
      workspaceId: ws,
      categoryId: "cat-404",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
  });
});
