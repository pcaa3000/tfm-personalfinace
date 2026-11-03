import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { Account } from "../../domain/account.js";

export interface AccountRepositoryPort {
  save(account: Account): Promise<void>;
  list(workspaceId: WorkspaceId): Promise<Account[]>;
  /** Currency of the account, or null when absent/archived/other workspace. */
  accountCurrency(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<string | null>;
  /** Active account or null when absent/archived/other workspace. */
  findById(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<Account | null>;
}

export const ACCOUNT_REPOSITORY = Symbol("ACCOUNT_REPOSITORY");
