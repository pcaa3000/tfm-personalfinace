/**
 * Async pipeline trigger (receipt-scan-drafts S9): after quarantine the
 * scan is dispatched to the worker's `receipt-scan` pg-boss queue, where
 * T4 will attach the extraction handler. The payload stays minimal —
 * the row is the source of truth.
 */
export interface ReceiptScanDispatcher {
  /**
   * Job payload {receiptId, workspaceId} mirrors LedgerEventJob — the
   * workspace scope lets the worker resolve the row through the
   * workspace-scoped repository port.
   */
  enqueueScan(receiptId: string, workspaceId: string): Promise<void>;
}

export const RECEIPT_SCAN_DISPATCHER = Symbol("RECEIPT_SCAN_DISPATCHER");

/** Queue name shared with the worker (jobs live under src/jobs + worker.ts). */
export const RECEIPT_SCAN_QUEUE = "receipt-scan";
