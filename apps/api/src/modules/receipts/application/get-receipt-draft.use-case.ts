import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type {
  ReceiptDraftPayload,
  ReceiptDraftPossibleDuplicate,
} from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type {
  TransactionDuplicateCriteria,
  TransactionDuplicatesPort,
} from "./ports/transaction-duplicates.port.js";

/** Semantic dedup window: a receipt ± 3 days around its business date. */
const DUPLICATE_WINDOW_DAYS = 3;

/** Pure UTC calendar-day shift — businessDate strings are TZ-free. */
function shiftIsoDay(isoDate: string, days: number): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Draft read for `GET /api/v1/receipts/:id/draft` (receipt-scan-drafts
 * T6, S2+S7): returns the stored `draft_payload` the review UI edits —
 * only while the scan is `draft_ready`; anything else is a conflict.
 *
 * T13 (S12) nivel 3: `possibleDuplicates` is computed HERE, at read
 * time — it is never persisted inside `draft_payload` so the warning
 * always reflects the ledger as it is when the user opens the review.
 */
export class GetReceiptDraftUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly duplicates: TransactionDuplicatesPort,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<ReceiptDraftPayload, DomainError>> {
    const scan = await this.scans.findById(workspaceId, id);
    if (!scan) {
      return err(
        new DomainError("RECEIPT_NOT_FOUND", `Receipt scan not found: ${id}`),
      );
    }
    if (scan.status !== "draft_ready" || scan.draftPayload === null) {
      return err(
        new DomainError(
          "RECEIPT_NOT_READY",
          `Receipt scan ${id} is not ready for review (status: ${scan.status})`,
        ),
      );
    }
    const draft = scan.draftPayload as ReceiptDraftPayload;
    return ok({
      ...draft,
      possibleDuplicates: await this.findPossibleDuplicates(
        workspaceId,
        draft,
      ),
    });
  }

  /**
   * Semantic dedup (T13, S12): same-amount workspace expenses matching
   * the ±3-day window around the draft date OR the merchant text. No
   * lookup at all when the draft carries no total or no semantic signal.
   */
  private async findPossibleDuplicates(
    workspaceId: WorkspaceId,
    draft: ReceiptDraftPayload,
  ): Promise<ReceiptDraftPossibleDuplicate[]> {
    if (draft.totalMinorUnits === null || draft.totalMinorUnits <= 0) {
      return [];
    }
    const merchant = draft.merchant?.trim();
    const criteria: TransactionDuplicateCriteria = {
      amountMinorUnits: Math.abs(draft.totalMinorUnits),
      ...(merchant ? { merchant } : {}),
      ...(draft.businessDate
        ? {
            fromDate: shiftIsoDay(
              draft.businessDate,
              -DUPLICATE_WINDOW_DAYS,
            ),
            toDate: shiftIsoDay(
              draft.businessDate,
              DUPLICATE_WINDOW_DAYS,
            ),
          }
        : {}),
    };
    if (!criteria.merchant && !criteria.fromDate) {
      return [];
    }
    return this.duplicates.findExpenseCandidates(workspaceId, criteria);
  }
}
