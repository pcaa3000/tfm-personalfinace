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
   * receipt-retention-30d T6 (S6): scans whose media was deleted
   * (`mediaDeletedAt IS NOT NULL`) are excluded at query level — a
   * row without its image adds nothing to the ticket list (the
   * confirmed transaction is untouched, CA-012).
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    query: ReceiptScanListQuery,
  ): Promise<ReceiptScanListSlice>;
}

/**
 * Row selected for media purge (receipt-retention-30d T6, S6): the
 * scan id + storage key are all the purge needs — one to delete the
 * object, the other to stamp the marker.
 */
export interface ReceiptMediaPurgeCandidate {
  readonly id: string;
  readonly storageKey: string;
}

/**
 * Manual media purge support (receipt-retention-30d T6, S6): the user
 * asks for media older than a chosen window (7/15/30 days by CAPTURE
 * AGE — `createdAt`, not `expiresAt`; that predicate belongs to the
 * daily cron purge). Workspace-scoped: unlike the cron job this is a
 * user action and never reaches across workspaces.
 */
export interface ReceiptMediaPurgePort {
  /**
   * Up to `limit` scans of the workspace with media still present
   * (`mediaDeletedAt IS NULL`) captured at or before `createdAtCutoff`
   * (`createdAt <= cutoff`, boundary inclusive — same `lte`
   * convention as the daily job's `expiresAt` predicate), oldest
   * first.
   */
  listMediaPurgeCandidates(
    workspaceId: WorkspaceId,
    createdAtCutoff: Date,
    limit: number,
  ): Promise<ReceiptMediaPurgeCandidate[]>;
  /**
   * Guarded media-deletion stamp (same guard as the daily purge job):
   * only a row whose `mediaDeletedAt` is still NULL is marked — a
   * concurrent early user DELETE keeps its own timestamp.
   */
  stampMediaDeleted(id: string, at: Date): Promise<void>;
}
