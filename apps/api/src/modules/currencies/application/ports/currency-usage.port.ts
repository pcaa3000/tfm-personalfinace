import type { WorkspaceId } from "../../../shared-kernel/index.js";

/** How many workspace records currently depend on a currency code. */
export interface CurrencyUsage {
  readonly accounts: number;
  readonly transactions: number;
}

/**
 * Read port: usage counts of a currency code across the workspace
 * (accounts and transactions, active or not — renaming or removing a
 * used code would corrupt historical arithmetic, INV-MON-02/04).
 */
export interface CurrencyUsagePort {
  usageOf(workspaceId: WorkspaceId, code: string): Promise<CurrencyUsage>;
}

export const CURRENCY_USAGE = Symbol("CURRENCY_USAGE");
