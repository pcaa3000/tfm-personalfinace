import type { WorkspaceId } from "../../../shared-kernel/index.js";

/** Consumer-owned port: ledger asks whether a category is usable. */
export interface CategoryValidationPort {
  existsForWorkspace(workspaceId: WorkspaceId, categoryId: string): Promise<boolean>;
}

export const CATEGORY_VALIDATION = Symbol("CATEGORY_VALIDATION");
