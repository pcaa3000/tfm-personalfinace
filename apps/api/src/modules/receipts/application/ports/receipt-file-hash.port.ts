import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { ReceiptScan } from "../../domain/receipt-scan.js";

/**
 * Exact-content dedup index (receipt-scan-drafts T13, S12 — "nivel 1"):
 * workspace-scoped lookup of a previously uploaded scan by the SHA-256
 * hex of its bytes. Backed by UNIQUE(workspaceId, fileHash); rows
 * written before T13 carry NULL and never match.
 */
export interface ReceiptFileHashPort {
  findByFileHash(
    workspaceId: WorkspaceId,
    fileHash: string,
  ): Promise<ReceiptScan | null>;
}

export const RECEIPT_FILE_HASH = Symbol("RECEIPT_FILE_HASH");
