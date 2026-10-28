import type { WorkspaceId } from "../../shared-kernel/index.js";

export interface CategoryView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
}

/** Read port: lists active categories usable by a workspace. */
export interface CategoryCatalogPort {
  listForWorkspace(workspaceId: WorkspaceId): Promise<CategoryView[]>;
}

export const CATEGORY_CATALOG = Symbol("CATEGORY_CATALOG");
