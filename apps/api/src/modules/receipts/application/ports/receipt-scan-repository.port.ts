import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { ReceiptScan } from "../../domain/receipt-scan.js";

/** Persistence port for the `receipts_receipt_scans` rows. */
export interface ReceiptScanRepositoryPort {
  save(scan: ReceiptScan): Promise<void>;
  /** Workspace-scoped lookup — a scan is never visible across workspaces. */
  findById(workspaceId: WorkspaceId, id: string): Promise<ReceiptScan | null>;
}

export const RECEIPT_SCAN_REPOSITORY = Symbol("RECEIPT_SCAN_REPOSITORY");

/**
 * Workspace-scoped list read (receipt-review-link T1, S1). Split from
 * {@link ReceiptScanRepositoryPort} so consumers that only enumerate
 * scans (the list use case) depend on a narrow port — the same
 * separation ReceiptFileHashPort already applies to this adapter.
 */
export interface ReceiptScanListPort {
  /** Every scan of the workspace, newest `createdAt` first. */
  listByWorkspace(workspaceId: WorkspaceId): Promise<ReceiptScan[]>;
}
