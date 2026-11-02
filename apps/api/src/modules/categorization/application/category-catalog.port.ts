import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { Category } from "../domain/category.js";

export interface CategoryView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
  /** true when the category belongs to the caller workspace (editable/archivable). */
  readonly custom: boolean;
}

export function toCategoryView(category: Category): CategoryView {
  return {
    id: category.id,
    key: category.key,
    label: category.label,
    nature: category.nature,
    custom: true,
  };
}

/** Read port: lists active categories usable by a workspace. */
export interface CategoryCatalogPort {
  listForWorkspace(workspaceId: WorkspaceId): Promise<CategoryView[]>;
}

export const CATEGORY_CATALOG = Symbol("CATEGORY_CATALOG");
