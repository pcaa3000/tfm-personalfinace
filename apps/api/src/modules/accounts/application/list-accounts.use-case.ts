import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  AccountListOptions,
  AccountRepositoryPort,
} from "./ports/account-repository.port.js";
import { toAccountView, type AccountView } from "./account.view.js";

export class ListAccountsUseCase {
  constructor(private readonly accounts: AccountRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    options?: AccountListOptions,
  ): Promise<AccountView[]> {
    const accounts = await this.accounts.list(workspaceId, options);
    return accounts.map(toAccountView);
  }
}
