import {
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { toAccountView, type AccountView } from "./account.view.js";

export interface ReviseAccountCommand {
  readonly workspaceId: WorkspaceId;
  readonly accountId: string;
  readonly name?: string;
  readonly kind?: string;
  readonly initialBalance?: string;
}

export class ReviseAccountUseCase {
  constructor(private readonly accounts: AccountRepositoryPort) {}

  async execute(command: ReviseAccountCommand): Promise<Result<AccountView, DomainError>> {
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

    if (command.name !== undefined) {
      const trimmed = command.name.trim();
      const siblings = await this.accounts.list(command.workspaceId);
      if (siblings.some((a) => a.id !== account.id && a.name === trimmed)) {
        return err(
          new DomainError(
            "ACCOUNT_NAME_TAKEN",
            `An account named "${trimmed}" already exists in this workspace`,
          ),
        );
      }
    }

    let initialBalance: Money | undefined;
    if (command.initialBalance !== undefined) {
      const money = Money.create(command.initialBalance, account.currency.code);
      if (!money.ok) {
        return money;
      }
      initialBalance = money.value;
    }

    const revised = account.revise({
      ...(command.name !== undefined ? { name: command.name } : {}),
      ...(command.kind !== undefined ? { kind: command.kind } : {}),
      ...(initialBalance !== undefined ? { initialBalance } : {}),
    });
    if (!revised.ok) {
      return revised;
    }

    await this.accounts.save(account);
    return ok(toAccountView(account));
  }
}
