import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import {
  toCategoryView,
  type CategoryView,
} from "./category-catalog.port.js";
import type { CategoryRepositoryPort } from "./ports/category-repository.port.js";

export interface ArchiveCategoryCommand {
  readonly workspaceId: WorkspaceId;
  readonly categoryId: string;
}

export class ArchiveCategoryUseCase {
  constructor(private readonly categories: CategoryRepositoryPort) {}

  async execute(
    command: ArchiveCategoryCommand,
  ): Promise<Result<CategoryView, DomainError>> {
    const category = await this.categories.findOwnedById(
      command.workspaceId,
      command.categoryId,
    );
    if (!category) {
      return err(
        new DomainError("CATEGORY_NOT_FOUND", "Category not found"),
      );
    }
    category.archive();
    await this.categories.save(category);
    return ok(toCategoryView(category));
  }
}
