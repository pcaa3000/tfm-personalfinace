import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import { toReceiptScanView, type ReceiptScanView } from "./receipt-scan.view.js";

/**
 * Early media deletion for `DELETE /api/v1/receipts/:id/file`
 * (receipt-retention-30d T3, S3, CA-012): deletes ONLY the storage
 * object through the port and stamps `mediaDeletedAt` — the scan row,
 * its status and the confirmed transaction are untouched. Works in any
 * scan status and is idempotent: storage drivers tolerate absent
 * objects, and an already-deleted medium keeps its first timestamp.
 */
export class DeleteReceiptFileUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly storage: ReceiptStoragePort,
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
    await this.storage.delete(scan.storageKey);
    if (scan.mediaDeletedAt === null) {
      scan.markMediaDeleted(this.clock.now());
      await this.scans.save(scan);
    }
    return ok(toReceiptScanView(scan));
  }
}
