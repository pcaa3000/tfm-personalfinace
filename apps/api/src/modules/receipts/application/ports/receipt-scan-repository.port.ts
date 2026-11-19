import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { ReceiptScan } from "../../domain/receipt-scan.js";

/** Persistence port for the `receipts_receipt_scans` rows. */
export interface ReceiptScanRepositoryPort {
  save(scan: ReceiptScan): Promise<void>;
  /** Workspace-scoped lookup — a scan is never visible across workspaces. */
  findById(workspaceId: WorkspaceId, id: string): Promise<ReceiptScan | null>;
}

export const RECEIPT_SCAN_REPOSITORY = Symbol("RECEIPT_SCAN_REPOSITORY");
