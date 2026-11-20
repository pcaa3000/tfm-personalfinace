import type { ReceiptScan } from "../domain/receipt-scan.js";

/**
 * Read model for the receipts API. Deliberately omits `storageKey` —
 * object-store internals never leave the boundary; clients fetch bytes
 * through `GET /api/v1/receipts/:id/file`.
 */
export interface ReceiptScanView {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly transactionId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** ISO instant the stored medium expires (fixed capture + 30d, S2). */
  readonly expiresAt: string;
  /** ISO instant the medium was deleted — null while it exists (S3). */
  readonly mediaDeletedAt: string | null;
}

/**
 * Trimmed list row for `GET /api/v1/receipts` (receipt-review-link T1,
 * S1): review state + file identity + the ticket↔movement link
 * (`transactionId`, null until the scan is confirmed).
 */
export interface ReceiptScanListItem {
  readonly id: string;
  readonly status: string;
  readonly originalFilename: string;
  readonly fileMimeType: string;
  readonly createdAt: string;
  readonly transactionId: string | null;
  /** ISO instant the stored medium expires (fixed capture + 30d, S2). */
  readonly expiresAt: string;
  /** ISO instant the medium was deleted — null while it exists (S3). */
  readonly mediaDeletedAt: string | null;
}

export function toReceiptScanListItem(scan: ReceiptScan): ReceiptScanListItem {
  return {
    id: scan.id,
    status: scan.status,
    originalFilename: scan.originalFilename,
    fileMimeType: scan.mimeType,
    createdAt: scan.createdAt.toISOString(),
    transactionId: scan.transactionId,
    expiresAt: scan.expiresAt.toISOString(),
    mediaDeletedAt: scan.mediaDeletedAt?.toISOString() ?? null,
  };
}

export function toReceiptScanView(scan: ReceiptScan): ReceiptScanView {
  return {
    id: scan.id,
    workspaceId: scan.workspaceId.value,
    status: scan.status,
    originalFilename: scan.originalFilename,
    mimeType: scan.mimeType,
    sizeBytes: scan.sizeBytes,
    transactionId: scan.transactionId,
    error: scan.error,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
    expiresAt: scan.expiresAt.toISOString(),
    mediaDeletedAt: scan.mediaDeletedAt?.toISOString() ?? null,
  };
}
