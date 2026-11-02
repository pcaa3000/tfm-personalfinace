import {
  DomainError,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { IdGenerator } from "../../ledger/index.js";
import { Category } from "../domain/category.js";
import {
  toCategoryView,
  type CategoryView,
} from "./category-catalog.port.js";
import type { CategoryRepositoryPort } from "./ports/category-repository.port.js";

export interface CreateCategoryCommand {
  readonly workspaceId: WorkspaceId;
  readonly key?: string;
  readonly label: string;
  readonly nature: string;
}

export class CreateCategoryUseCase {
  constructor(
    private readonly categories: CategoryRepositoryPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    command: CreateCategoryCommand,
  ): Promise<Result<CategoryView, DomainError>> {
    const key = command.key ?? Category.deriveKey(command.label);
    if (
      await this.categories.existsKey(command.workspaceId, key)
    ) {
      return err(
        new DomainError(
          "CATEGORY_KEY_TAKEN",
          `A category with key "${key}" already exists in this workspace`,
        ),
      );
    }
    const category = Category.createCustom({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      key,
      label: command.label,
      nature: command.nature,
    });
    if (!category.ok) {
      return category;
    }
    await this.categories.save(category.value);
    return ok(toCategoryView(category.value));
  }
}
