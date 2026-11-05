import type { WorkspaceId } from "../../shared-kernel/index.js";

/**
 * Bootstrap port: copies the editable seed categories into a freshly
 * created workspace, so every category the user sees can be revised
 * and archived (L24/T19). The system `uncategorized` fallback is
 * never copied — it stays a protected global entry.
 * Implemented by the categorization module, which owns the catalog;
 * identity-workspace stays decoupled from its storage.
 */
export interface CategoryCatalogProvisionerPort {
  ensureSeedCategories(workspaceId: WorkspaceId): Promise<void>;
}

export const CATEGORY_SEED_PROVISIONER = Symbol("CATEGORY_SEED_PROVISIONER");
