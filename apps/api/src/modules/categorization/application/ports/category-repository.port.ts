import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { Category } from "../../domain/category.js";

/** Write-side access to workspace-owned categories. */
export interface CategoryRepositoryPort {
  save(category: Category): Promise<void>;

  /** Active category owned by the workspace, or null (global, archived, foreign or unknown). */
  findOwnedById(workspaceId: WorkspaceId, id: string): Promise<Category | null>;

  /** Whether the key is already used by any workspace category (active or archived). */
  existsKey(workspaceId: WorkspaceId, key: string): Promise<boolean>;
}

export const CATEGORY_REPOSITORY = Symbol("CATEGORY_REPOSITORY");
