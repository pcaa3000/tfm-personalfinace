import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { toReceiptScanView, type ReceiptScanView } from "./receipt-scan.view.js";

/**
 * User discard for `POST /api/v1/receipts/:id/reject` (T6, S2): any
 * non-terminal scan (pending quarantine, failed-to-review draft) moves
 * to `rejected`; terminal states (confirmed/rejected/failed) conflict.
 */
export class RejectReceiptScanUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
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
    if (scan.isTerminal) {
      return err(
        new DomainError(
          "RECEIPT_ALREADY_FINAL",
          `Receipt scan ${id} is already ${scan.status} and cannot be rejected`,
        ),
      );
    }
    scan.markRejected(this.clock.now());
    await this.scans.save(scan);
    return ok(toReceiptScanView(scan));
  }
}
