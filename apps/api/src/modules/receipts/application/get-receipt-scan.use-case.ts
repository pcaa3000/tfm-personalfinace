import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { toReceiptScanView, type ReceiptScanView } from "./receipt-scan.view.js";

/** Polling read for `GET /api/v1/receipts/:id` (receipt-scan-drafts T3). */
export class GetReceiptScanUseCase {
  constructor(private readonly scans: ReceiptScanRepositoryPort) {}

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
    return ok(toReceiptScanView(scan));
  }
}
