import {
  DomainError,
  Money,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

export interface TransactionSplitInput {
  readonly categoryId: string;
  readonly amount: Money;
}

/**
 * Category-level breakdown of a transaction amount (receipt-scan-drafts S4).
 * A transaction carries 0..N splits; when splits exist, INV-TRX-SPLIT-01
 * requires the sum of split amounts to equal the transaction amount exactly
 * in integer minor units — the aggregate enforces that in its mutation
 * paths, while existence of the category is validated at use-case level.
 */
export class TransactionSplit {
  private constructor(
    readonly categoryId: string,
    readonly amount: Money,
  ) {}

  static create(input: TransactionSplitInput): Result<TransactionSplit, DomainError> {
    const categoryId = input.categoryId.trim();
    if (categoryId.length === 0) {
      return err(
        new DomainError(
          "TRANSACTION_SPLIT_CATEGORY_REQUIRED",
          "A split requires a category (INV-TRX-SPLIT-01)",
        ),
      );
    }
    if (!input.amount.isPositive()) {
      return err(
        new DomainError(
          "TRANSACTION_SPLIT_AMOUNT_NOT_POSITIVE",
          "Split amount must be greater than zero (INV-TRX-SPLIT-01)",
        ),
      );
    }
    return ok(new TransactionSplit(categoryId, input.amount));
  }

  /** Rebuilds a persisted split without re-validating. */
  static reconstitute(state: TransactionSplitInput): TransactionSplit {
    return new TransactionSplit(state.categoryId, state.amount);
  }
}
