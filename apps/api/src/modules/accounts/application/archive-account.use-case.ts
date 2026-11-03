import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { toAccountView, type AccountView } from "./account.view.js";

export interface ArchiveAccountCommand {
  readonly workspaceId: WorkspaceId;
  readonly accountId: string;
}

export class ArchiveAccountUseCase {
  constructor(private readonly accounts: AccountRepositoryPort) {}

  async execute(command: ArchiveAccountCommand): Promise<Result<AccountView, DomainError>> {
    const account = await this.accounts.findById(
      command.workspaceId,
      command.accountId,
    );
    if (!account) {
      return err(
        new DomainError(
          "ACCOUNT_NOT_FOUND",
          `Account does not exist in this workspace: ${command.accountId}`,
        ),
      );
    }
    const archived = account.archive();
    if (!archived.ok) {
      return archived;
    }
    await this.accounts.save(account);
    return ok(toAccountView(account));
  }
}
