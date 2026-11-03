import {
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import { Account } from "../domain/account.js";
import type { IdGenerator } from "../../ledger/index.js";
import type { AccountRepositoryPort } from "./ports/account-repository.port.js";
import { toAccountView, type AccountView } from "./account.view.js";

export interface CreateAccountCommand {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly currency: string;
  readonly kind: string;
  readonly initialBalance?: string;
}

export class CreateAccountUseCase {
  constructor(
    private readonly accounts: AccountRepositoryPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: CreateAccountCommand): Promise<Result<AccountView, DomainError>> {
    const existing = await this.accounts.list(command.workspaceId);
    if (existing.some((a) => a.name === command.name.trim())) {
      return err(
        new DomainError(
          "ACCOUNT_NAME_TAKEN",
          `An account named "${command.name.trim()}" already exists in this workspace`,
        ),
      );
    }
    let initialBalance: Money | undefined;
    if (command.initialBalance !== undefined) {
      const money = Money.create(command.initialBalance, command.currency);
      if (!money.ok) {
        return money;
      }
      initialBalance = money.value;
    }
    const account = Account.create({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      name: command.name,
      currency: command.currency,
      kind: command.kind,
      ...(initialBalance !== undefined ? { initialBalance } : {}),
    });
    if (!account.ok) {
      return account;
    }
    await this.accounts.save(account.value);
    return ok(toAccountView(account.value));
  }
}
