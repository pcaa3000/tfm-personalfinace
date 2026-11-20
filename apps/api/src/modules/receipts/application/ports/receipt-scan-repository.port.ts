import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { ReceiptScan } from "../../domain/receipt-scan.js";
import type { ReceiptScanCursor } from "../receipt-scan-cursor.js";

/** Persistence port for the `receipts_receipt_scans` rows. */
export interface ReceiptScanRepositoryPort {
  save(scan: ReceiptScan): Promise<void>;
  /** Workspace-scoped lookup — a scan is never visible across workspaces. */
  findById(workspaceId: WorkspaceId, id: string): Promise<ReceiptScan | null>;
}

export const RECEIPT_SCAN_REPOSITORY = Symbol("RECEIPT_SCAN_REPOSITORY");

/**
 * Keyset page request for the workspace list (receipt-review-link T5,
 * S4): `limit` rows strictly after the exclusive `after` position in
 * `createdAt DESC, id DESC` order.
 */
export interface ReceiptScanListQuery {
  /** Page size — the HTTP edge already enforces 1..100. */
  readonly limit: number;
  /** Exclusive keyset position; absent → first (newest) page. */
  readonly after?: ReceiptScanCursor;
}

export interface ReceiptScanListSlice {
  readonly scans: ReceiptScan[];
  /** True when further rows exist beyond this slice. */
  readonly hasMore: boolean;
}

/**
 * Workspace-scoped list read (receipt-review-link T1, S1). Split from
 * {@link ReceiptScanRepositoryPort} so consumers that only enumerate
 * scans (the list use case) depend on a narrow port — the same
 * separation ReceiptFileHashPort already applies to this adapter.
 */
export interface ReceiptScanListPort {
  /**
   * Up to `query.limit` scans of the workspace, newest first
   * (`createdAt DESC, id DESC`), strictly after `query.after` when set
   * (T5, S4: keyset/seek — stable under concurrent inserts).
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    query: ReceiptScanListQuery,
  ): Promise<ReceiptScanListSlice>;
}
