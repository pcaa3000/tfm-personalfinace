import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import {
  UNCATEGORIZED,
  categorized,
  type CategoryAssignment,
} from "../domain/transaction.js";
import type { AccountValidationPort } from "./ports/account-validation.port.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";
import type { Clock } from "./ports/clock.port.js";
import type { TransactionRepositoryPort } from "./ports/transaction-repository.port.js";
import { toTransactionView, type TransactionView } from "./transaction.view.js";

/**
 * Partial revision command. Every field is optional; absent fields keep
 * their stored value. `categoryId: null` assigns the explicit
 * uncategorized state (RF-015).
 */
export interface ReviseTransactionCommand {
  readonly workspaceId: WorkspaceId;
  readonly transactionId: string;
  readonly type?: "income" | "expense";
  readonly amount?: string;
  readonly currency?: string;
  readonly businessDate?: string;
  readonly timezone?: string;
  readonly concept?: string;
  readonly accountId?: string;
  readonly categoryId?: string | null;
  readonly actor: string;
}

export class ReviseTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepositoryPort,
    private readonly accounts: AccountValidationPort,
    private readonly categories: CategoryValidationPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: ReviseTransactionCommand,
  ): Promise<Result<TransactionView, DomainError>> {
    const transaction = await this.transactions.findById(
      command.workspaceId,
      command.transactionId,
    );
    if (!transaction) {
      return err(
        new DomainError(
          "TRANSACTION_NOT_FOUND",
          `Transaction not found: ${command.transactionId}`,
        ),
      );
    }

    let amount: Money | undefined;
    if (command.amount !== undefined || command.currency !== undefined) {
      const created = Money.create(
        command.amount ?? transaction.amount.toDecimalString(),
        command.currency ?? transaction.amount.currency.code,
      );
      if (!created.ok) {
        return created;
      }
      amount = created.value;
    }

    const effectiveAccountId = command.accountId ?? transaction.accountId;
    if (
      command.accountId !== undefined ||
      (command.currency !== undefined && effectiveAccountId !== null)
    ) {
      const accountCurrency = await this.accounts.accountCurrency(
        command.workspaceId,
        effectiveAccountId!,
      );
      if (accountCurrency === null) {
        return err(
          new DomainError(
            "ACCOUNT_NOT_FOUND",
            `Account does not exist in this workspace: ${effectiveAccountId}`,
          ),
        );
      }
      const effectiveCurrency = (amount ?? transaction.amount).currency.code;
      if (accountCurrency !== effectiveCurrency) {
        return err(
          new DomainError(
            "ACCOUNT_CURRENCY_MISMATCH",
            `Transaction currency ${effectiveCurrency} does not match account currency ${accountCurrency}`,
          ),
        );
      }
    }

    let businessDate: BusinessDate | undefined;
    if (
      command.businessDate !== undefined ||
      command.timezone !== undefined
    ) {
      const created = BusinessDate.create(
        command.businessDate ?? transaction.businessDate.isoDate,
        command.timezone ?? transaction.businessDate.timezone,
      );
      if (!created.ok) {
        return created;
      }
      businessDate = created.value;
    }

    let category: CategoryAssignment | undefined;
    if (command.categoryId !== undefined) {
      if (command.categoryId === null) {
        category = UNCATEGORIZED;
      } else {
        if (
          !(await this.categories.existsForWorkspace(
            command.workspaceId,
            command.categoryId,
          ))
        ) {
          return err(
            new DomainError(
              "CATEGORY_NOT_FOUND",
              `Category does not exist in this workspace: ${command.categoryId}`,
            ),
          );
        }
        category = categorized(command.categoryId);
      }
    }

    const revision = transaction.revise({
      ...(command.type !== undefined ? { type: command.type } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(businessDate !== undefined ? { businessDate } : {}),
      ...(command.concept !== undefined ? { concept: command.concept } : {}),
      ...(command.accountId !== undefined ? { accountId: command.accountId } : {}),
      ...(category !== undefined ? { category } : {}),
      revisedAt: this.clock.now(),
      revisedBy: command.actor,
    });
    if (!revision.ok) {
      return revision;
    }

    await this.transactions.save(transaction);
    return ok(toTransactionView(transaction));
  }
}
