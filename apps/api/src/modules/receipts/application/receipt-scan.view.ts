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
  };
}
