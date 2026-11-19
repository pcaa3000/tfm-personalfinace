import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";

export interface ReceiptFileView {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly originalFilename: string;
}

/**
 * Streams a stored receipt through the API (T3: acceptable until signed
 * URLs land). Row lookup is workspace-scoped, so a scan — and its bytes —
 * are never served across workspaces.
 */
export class GetReceiptFileUseCase {
  constructor(
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly storage: ReceiptStoragePort,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<ReceiptFileView, DomainError>> {
    const scan = await this.scans.findById(workspaceId, id);
    if (!scan) {
      return err(
        new DomainError("RECEIPT_NOT_FOUND", `Receipt scan not found: ${id}`),
      );
    }
    const bytes = await this.storage.open(scan.storageKey);
    if (bytes === null) {
      return err(
        new DomainError(
          "RECEIPT_FILE_MISSING",
          `Stored object missing for receipt scan: ${id}`,
        ),
      );
    }
    return ok({
      bytes,
      mimeType: scan.mimeType,
      originalFilename: scan.originalFilename,
    });
  }
}
