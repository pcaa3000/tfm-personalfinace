import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import { Transaction, UNCATEGORIZED, categorized } from "../domain/transaction.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";
import type { Clock } from "./ports/clock.port.js";
import type { IdGenerator } from "./ports/id-generator.port.js";
import type { TransactionRepositoryPort } from "./ports/transaction-repository.port.js";
import { toTransactionView, type TransactionView } from "./transaction.view.js";

export interface RecordManualTransactionCommand {
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly type: "income" | "expense";
  readonly amount: string;
  readonly currency: string;
  readonly businessDate: string;
  readonly timezone: string;
  readonly concept: string;
  /** null = explicit uncategorized choice. */
  readonly categoryId: string | null;
  readonly actor: string;
}

export class RecordManualTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepositoryPort,
    private readonly categories: CategoryValidationPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    command: RecordManualTransactionCommand,
  ): Promise<Result<TransactionView, DomainError>> {
    // Idempotent replay: a repeated creation key returns the stored record.
    const existing = await this.transactions.findByIdempotencyKey(
      command.workspaceId,
      command.idempotencyKey,
    );
    if (existing) {
      return ok(toTransactionView(existing));
    }

    const money = Money.create(command.amount, command.currency);
    if (!money.ok) {
      return money;
    }
    const businessDate = BusinessDate.create(command.businessDate, command.timezone);
    if (!businessDate.ok) {
      return businessDate;
    }
    if (
      command.categoryId !== null &&
      !(await this.categories.existsForWorkspace(command.workspaceId, command.categoryId))
    ) {
      return err(
        new DomainError(
          "CATEGORY_NOT_FOUND",
          `Category does not exist in this workspace: ${command.categoryId}`,
        ),
      );
    }

    const transaction = Transaction.recordManual({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      idempotencyKey: command.idempotencyKey,
      type: command.type,
      amount: money.value,
      businessDate: businessDate.value,
      concept: command.concept,
      category:
        command.categoryId === null
          ? UNCATEGORIZED
          : categorized(command.categoryId),
      confirmedAt: this.clock.now(),
      confirmedBy: command.actor,
    });
    if (!transaction.ok) {
      return transaction;
    }

    await this.transactions.save(transaction.value);
    return ok(toTransactionView(transaction.value));
  }
}
