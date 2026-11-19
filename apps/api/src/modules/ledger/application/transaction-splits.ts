import {
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import { TransactionSplit } from "../domain/transaction-split.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";

/**
 * Transport/use-case shape of a split: the amount travels as an integer
 * count of minor units in the transaction currency (HTTP contract T2/S4).
 */
export interface TransactionSplitCommand {
  readonly categoryId: string;
  /** Integer minor units of the transaction currency; must be > 0. */
  readonly amount: number;
}

/**
 * Builds domain splits from command input and checks that every referenced
 * category exists in the workspace (same CATEGORY_NOT_FOUND contract as the
 * transaction-level categoryId). Pass `categories: null` to skip existence
 * checks — transfers reject splits in the aggregate before they matter.
 * INV-TRX-SPLIT-01 sum/currency rules stay in the aggregate; this helper
 * only constructs valid VOs.
 */
export async function buildTransactionSplits(
  inputs: readonly TransactionSplitCommand[],
  currencyCode: string,
  workspaceId: WorkspaceId,
  categories: CategoryValidationPort | null,
): Promise<Result<TransactionSplit[], DomainError>> {
  const splits: TransactionSplit[] = [];
  for (const input of inputs) {
    if (!Number.isInteger(input.amount)) {
      return err(
        new DomainError(
          "TRANSACTION_SPLIT_AMOUNT_NOT_POSITIVE",
          "Split amount must be a positive integer of minor units (INV-TRX-SPLIT-01)",
        ),
      );
    }
    const amount = Money.fromMinorUnits(BigInt(input.amount), currencyCode);
    if (!amount.ok) {
      return amount;
    }
    const split = TransactionSplit.create({
      categoryId: input.categoryId,
      amount: amount.value,
    });
    if (!split.ok) {
      return split;
    }
    if (
      categories !== null &&
      !(await categories.existsForWorkspace(
        workspaceId,
        split.value.categoryId,
      ))
    ) {
      return err(
        new DomainError(
          "CATEGORY_NOT_FOUND",
          `Category does not exist in this workspace: ${split.value.categoryId}`,
        ),
      );
    }
    splits.push(split.value);
  }
  return ok(splits);
}
