import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Category } from "../domain/category.js";
import type { CategoryRepositoryPort } from "./ports/category-repository.port.js";
import { CreateCategoryUseCase } from "./create-category.use-case.js";

class InMemoryCategories implements CategoryRepositoryPort {
  saved: Category[] = [];
  keys = new Set<string>();

  async save(category: Category) {
    this.saved.push(category);
  }
  async findOwnedById(_workspaceId: WorkspaceId, _id: string) {
    return null;
  }
  async existsKey(_workspaceId: WorkspaceId, key: string) {
    return this.keys.has(key);
  }
}

const ids = { next: () => "cat-generated" };

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

describe("CreateCategoryUseCase (RF-040, RF-041)", () => {
  it("creates a workspace category and returns its view", async () => {
    const repo = new InMemoryCategories();
    const useCase = new CreateCategoryUseCase(repo, ids);

    const result = await useCase.execute({
      workspaceId: ws,
      key: "pets",
      label: "Mascotas",
      nature: "discretionary",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      id: "cat-generated",
      key: "pets",
      label: "Mascotas",
      nature: "discretionary",
      custom: true,
    });
    expect(repo.saved).toHaveLength(1);
  });

  it("derives the key from the label when it is not provided", async () => {
    const repo = new InMemoryCategories();
    const useCase = new CreateCategoryUseCase(repo, ids);

    const result = await useCase.execute({
      workspaceId: ws,
      label: "Mascotas y Veterinaria",
      nature: "essential",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe("mascotas_y_veterinaria");
  });

  it("rejects a key already used in the workspace", async () => {
    const repo = new InMemoryCategories();
    repo.keys.add("pets");
    const useCase = new CreateCategoryUseCase(repo, ids);

    const result = await useCase.execute({
      workspaceId: ws,
      key: "pets",
      label: "Otras mascotas",
      nature: "essential",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CATEGORY_KEY_TAKEN");
    expect(repo.saved).toHaveLength(0);
  });
});
