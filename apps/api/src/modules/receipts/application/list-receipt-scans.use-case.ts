import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { ReceiptScanListPort } from "./ports/receipt-scan-repository.port.js";
import {
  toReceiptScanListItem,
  type ReceiptScanListItem,
} from "./receipt-scan.view.js";

/**
 * Workspace ticket-review list (receipt-review-link T1, S1+S3): every
 * scan in any state, newest first; `transactionId` is null until the
 * scan is confirmed.
 */
export class ListReceiptScansUseCase {
  constructor(private readonly scans: ReceiptScanListPort) {}

  async execute(workspaceId: WorkspaceId): Promise<ReceiptScanListItem[]> {
    const scans = await this.scans.listByWorkspace(workspaceId);
    return scans.map(toReceiptScanListItem);
  }
}
