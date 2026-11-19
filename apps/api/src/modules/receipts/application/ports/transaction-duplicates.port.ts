import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { ReceiptDraftPossibleDuplicate } from "../../domain/receipt-draft.js";

/**
 * Semantic duplicate criteria (receipt-scan-drafts T13, S12 — "nivel
 * 3"): a candidate matches when its absolute amount equals
 * `amountMinorUnits` AND (its businessDate falls inside
 * [`fromDate`,`toDate`] OR its concept ILIKE-matches `merchant`). When
 * neither the window nor the merchant is provided there is no semantic
 * signal and the adapter returns no candidates.
 */
export interface TransactionDuplicateCriteria {
  /** Absolute draft total in minor units. */
  readonly amountMinorUnits: number;
  /** YYYY-MM-DD inclusive bounds of the date window (both or neither). */
  readonly fromDate?: string;
  readonly toDate?: string;
  /** Merchant text matched case-insensitively against `concept`. */
  readonly merchant?: string;
}

/**
 * Read-side query over ledger expenses (T13, S12): confirmed
 * `expense` transactions in the workspace that plausibly already record
 * the receipt under review. Read-only — the adapter never writes to
 * the ledger tables.
 */
export interface TransactionDuplicatesPort {
  findExpenseCandidates(
    workspaceId: WorkspaceId,
    criteria: TransactionDuplicateCriteria,
  ): Promise<ReceiptDraftPossibleDuplicate[]>;
}

export const TRANSACTION_DUPLICATES = Symbol("TRANSACTION_DUPLICATES");
