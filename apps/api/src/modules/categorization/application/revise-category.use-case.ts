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

export interface ReviseCategoryCommand {
  readonly workspaceId: WorkspaceId;
  readonly categoryId: string;
  readonly label?: string;
  readonly nature?: string;
}

export class ReviseCategoryUseCase {
  constructor(private readonly categories: CategoryRepositoryPort) {}

  async execute(
    command: ReviseCategoryCommand,
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
    const revised = category.revise({
      ...(command.label !== undefined ? { label: command.label } : {}),
      ...(command.nature !== undefined ? { nature: command.nature } : {}),
    });
    if (!revised.ok) {
      return revised;
    }
    await this.categories.save(category);
    return ok(toCategoryView(category));
  }
}
