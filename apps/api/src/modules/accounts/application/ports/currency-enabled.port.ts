import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Lookup port: whether a currency code is active in the workspace
 * catalog (INV-MON-03). Implemented by the currencies module, which
 * owns the catalog; accounts stays decoupled from its storage.
 */
export interface CurrencyEnabledPort {
  isEnabled(workspaceId: WorkspaceId, code: string): Promise<boolean>;
}

export const CURRENCY_ENABLED = Symbol("CURRENCY_ENABLED");
