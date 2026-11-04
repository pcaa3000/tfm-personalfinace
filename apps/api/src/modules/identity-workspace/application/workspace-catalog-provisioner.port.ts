import type { WorkspaceId } from "../../shared-kernel/index.js";

/**
 * Bootstrap port: seeds the workspace currency catalog when a workspace
 * is created (each workspace starts with at least its defaultCurrency,
 * INV-MON-01..03). Implemented by the currencies module, which owns the
 * catalog; identity-workspace stays decoupled from its storage.
 */
export interface WorkspaceCatalogProvisionerPort {
  ensureDefaultCurrency(
    workspaceId: WorkspaceId,
    code: string,
  ): Promise<void>;
}

export const WORKSPACE_CATALOG_PROVISIONER = Symbol(
  "WORKSPACE_CATALOG_PROVISIONER",
);
