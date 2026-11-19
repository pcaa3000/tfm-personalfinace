import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import type { ReceiptScanDispatcher } from "./ports/receipt-scan-dispatcher.port.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { toReceiptScanView, type ReceiptScanView } from "./receipt-scan.view.js";

/**
 * Retry without re-upload for `POST /api/v1/receipts/:id/retry`
 * (receipt-scan-drafts T12, S11):
 *   failed               → back to `pending` (error cleared) + the same
 *                          scan job is re-enqueued over the original
 *                          storageKey — the image is never re-uploaded.
 *   pending / extracted / draft_ready → idempotent no-op: the job is
 *                          still in flight or the draft is reviewable,
 *                          so no re-enqueue is needed.
 *   confirmed / rejected → RECEIPT_ALREADY_FINAL (409): user-final.
 *   missing / foreign    → RECEIPT_NOT_FOUND (404).
 */
export class RetryReceiptScanUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly dispatcher: ReceiptScanDispatcher,
    private readonly clock: Clock,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<ReceiptScanView, DomainError>> {
    const scan = await this.scans.findById(workspaceId, id);
    if (!scan) {
      return err(
        new DomainError("RECEIPT_NOT_FOUND", `Receipt scan not found: ${id}`),
      );
    }
    if (scan.status === "confirmed" || scan.status === "rejected") {
      return err(
        new DomainError(
          "RECEIPT_ALREADY_FINAL",
          `Receipt scan ${id} is already ${scan.status} and cannot be retried`,
        ),
      );
    }
    if (scan.status === "failed") {
      scan.resetToPending(this.clock.now());
      await this.scans.save(scan);
      // Same convention as upload: a dispatch failure is logged but the
      // pending row remains the recoverable source of truth.
      try {
        await this.dispatcher.enqueueScan(scan.id, scan.workspaceId.value);
      } catch (cause) {
        console.error(
          `[receipts] failed to re-enqueue receipt-scan job for ${scan.id}:`,
          cause,
        );
        // R4-RETRY-LOST-JOB: a pending row without a job is a dead end —
        // retry treats `pending` as a no-op and upload dedup returns it
        // unchanged, so nothing would ever re-enqueue. Mark the scan
        // `failed` instead so the retry endpoint stays reachable.
        scan.markFailed(
          "receipt-scan dispatch failed",
          this.clock.now(),
        );
        await this.scans.save(scan);
      }
    }
    return ok(toReceiptScanView(scan));
  }
}
