import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReceiptDraftPayload } from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";

/**
 * Draft read for `GET /api/v1/receipts/:id/draft` (receipt-scan-drafts
 * T6, S2+S7): returns the stored `draft_payload` the review UI edits —
 * only while the scan is `draft_ready`; anything else is a conflict.
 */
export class GetReceiptDraftUseCase {
  constructor(private readonly scans: ReceiptScanRepositoryPort) {}

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
    return ok(scan.draftPayload as ReceiptDraftPayload);
  }
}
