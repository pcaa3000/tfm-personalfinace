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
  Transaction,
  UNCATEGORIZED,
  categorized,
  type TransactionOrigin,
  type TransactionType,
} from "../domain/transaction.js";
import type { TransactionSplit } from "../domain/transaction-split.js";
import type { AccountValidationPort } from "./ports/account-validation.port.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";
import type { Clock } from "./ports/clock.port.js";
import type { IdGenerator } from "./ports/id-generator.port.js";
import type { TransactionRepositoryPort } from "./ports/transaction-repository.port.js";
import {
  buildTransactionSplits,
  type TransactionSplitCommand,
} from "./transaction-splits.js";
import { toTransactionView, type TransactionView } from "./transaction.view.js";

export interface RecordManualTransactionCommand {
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly type: TransactionType;
  readonly amount: string;
  readonly currency: string;
  readonly businessDate: string;
  readonly timezone: string;
  readonly concept: string;
  /** Account holding the money; must exist and share the amount's currency. */
  readonly accountId: string;
  /** Destination account for transfers; required on transfer, forbidden on income/expense. */
  readonly destinationAccountId?: string | null;
  /** null = explicit uncategorized choice. */
  readonly categoryId: string | null;
  /**
   * Optional explicit merchant (S6 — the receipt confirm forwards
   * `draftPayload.merchant`). Normalized by the aggregate; null or absent
   * falls back to the concept-derived value.
   */
  readonly merchant?: string | null;
  /**
   * Optional category-level breakdown; amounts are integer minor units of
   * the transaction currency. When non-empty it must satisfy
   * INV-TRX-SPLIT-01 (sum equals the transaction amount); forbidden on
   * transfers.
   */
  readonly splits?: readonly TransactionSplitCommand[];
  /** Entry channel; defaults to "manual" — the receipt confirm passes "ticket" (T6). */
  readonly origin?: TransactionOrigin;
  /** Optional external reference tied to the origin (e.g. the receipt scan id). */
  readonly originReference?: string;
  readonly actor: string;
}

export class RecordManualTransactionUseCase {
  constructor(
    private readonly transactions: TransactionRepositoryPort,
    private readonly accounts: AccountValidationPort,
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
    const accountCurrency = await this.accounts.accountCurrency(
      command.workspaceId,
      command.accountId,
    );
    if (accountCurrency === null) {
      return err(
        new DomainError(
          "ACCOUNT_NOT_FOUND",
          `Account does not exist in this workspace: ${command.accountId}`,
        ),
      );
    }
    if (accountCurrency !== money.value.currency.code) {
      return err(
        new DomainError(
          "ACCOUNT_CURRENCY_MISMATCH",
          `Transaction currency ${money.value.currency.code} does not match account currency ${accountCurrency}`,
        ),
      );
    }

    const destinationAccountId = command.destinationAccountId ?? null;
    if (command.type === "transfer") {
      if (
        destinationAccountId === null ||
        destinationAccountId.trim().length === 0
      ) {
        return err(
          new DomainError(
            "TRANSFER_DESTINATION_REQUIRED",
            "A transfer requires a destination account (INV-TFR-01)",
          ),
        );
      }
      if (destinationAccountId === command.accountId) {
        return err(
          new DomainError(
            "TRANSFER_SAME_ACCOUNT",
            "Transfer source and destination accounts must differ (INV-TFR-02)",
          ),
        );
      }
      const destinationCurrency = await this.accounts.accountCurrency(
        command.workspaceId,
        destinationAccountId,
      );
      if (destinationCurrency === null) {
        return err(
          new DomainError(
            "ACCOUNT_NOT_FOUND",
            `Destination account does not exist in this workspace: ${destinationAccountId}`,
          ),
        );
      }
      if (destinationCurrency !== money.value.currency.code) {
        return err(
          new DomainError(
            "ACCOUNT_CURRENCY_MISMATCH",
            `Transaction currency ${money.value.currency.code} does not match destination account currency ${destinationCurrency}`,
          ),
        );
      }
    } else if (destinationAccountId !== null) {
      return err(
        new DomainError(
          "TRANSFER_DESTINATION_FORBIDDEN",
          "Only transfer transactions may specify a destination account",
        ),
      );
    }

    if (
      command.type !== "transfer" &&
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

    let splits: TransactionSplit[] = [];
    if (command.splits !== undefined) {
      const built = await buildTransactionSplits(
        command.splits,
        money.value.currency.code,
        command.workspaceId,
        // Transfers cannot carry splits; the aggregate rejects them, so
        // there is no category to validate on that path.
        command.type === "transfer" ? null : this.categories,
      );
      if (!built.ok) {
        return built;
      }
      splits = built.value;
    }

    const transaction = Transaction.recordManual({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      idempotencyKey: command.idempotencyKey,
      type: command.type,
      amount: money.value,
      businessDate: businessDate.value,
      concept: command.concept,
      accountId: command.accountId,
      destinationAccountId,
      category:
        command.type === "transfer" || command.categoryId === null
          ? UNCATEGORIZED
          : categorized(command.categoryId),
      ...(command.merchant !== undefined
        ? { merchant: command.merchant }
        : {}),
      splits,
      ...(command.origin !== undefined ? { origin: command.origin } : {}),
      ...(command.originReference !== undefined
        ? { originReference: command.originReference }
        : {}),
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
