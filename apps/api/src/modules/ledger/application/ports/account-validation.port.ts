import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Lookup port: resolves the currency of an account owned by the workspace,
 * or null when it does not exist/is archived. Used to enforce
 * "transaction currency = account currency" without coupling ledger to
 * the accounts module.
 */
export interface AccountValidationPort {
  accountCurrency(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<string | null>;
}

export const ACCOUNT_VALIDATION = Symbol("ACCOUNT_VALIDATION");
