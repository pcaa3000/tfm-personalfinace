import { getReceiptDraft, getReceiptScan, uploadReceipt } from "./api";
import type { ReceiptDraftPayload, ReceiptScanView } from "./receipt-draft";

/**
 * Upload → poll → draft orchestration (receipt-scan-drafts T7, S1+S2).
 * The API is async: `POST /receipts` returns a `pending` scan and a
 * worker extracts + categorizes; the web polls `GET /receipts/:id`
 * until `draft_ready`, then loads `GET /receipts/:id/draft`.
 */

/** The pipeline reported a dead-end terminal status for the scan. */
export class ReceiptScanFailedError extends Error {
  readonly scanError: string | null;

  constructor(scanError: string | null) {
    super(scanError ?? "Receipt scan failed");
    this.name = "ReceiptScanFailedError";
    this.scanError = scanError;
  }
}

/** The scan stayed non-terminal beyond the polling budget. */
export class ReceiptPollTimeoutError extends Error {
  constructor() {
    super("Receipt scan polling timed out");
    this.name = "ReceiptPollTimeoutError";
  }
}

export type ReceiptFlowPhase = "uploading" | "analyzing";

export interface UploadAndAwaitDraftOptions {
  /** Poll cadence — defaults to ~2s. */
  pollIntervalMs?: number;
  /** Overall polling budget — defaults to ~60s. */
  timeoutMs?: number;
  onPhase?: (phase: ReceiptFlowPhase) => void;
  upload?: (file: File) => Promise<ReceiptScanView>;
  getScan?: (id: string) => Promise<ReceiptScanView>;
  getDraft?: (id: string) => Promise<ReceiptDraftPayload>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Terminal statuses where polling stops without a draft. */
const DEAD_END_STATUSES = new Set(["failed", "confirmed", "rejected"]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Uploads the image and polls until the draft is ready. Network
 * failures (TypeError) propagate untouched so the UI can show the
 * "receipts require connection" message — IndexedDB cannot hold
 * binaries, so no offline queue exists for uploads.
 */
export async function uploadAndAwaitDraft(
  file: File,
  options: UploadAndAwaitDraftOptions = {},
): Promise<{ scan: ReceiptScanView; draft: ReceiptDraftPayload }> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const upload = options.upload ?? uploadReceipt;
  const getScan = options.getScan ?? getReceiptScan;
  const getDraft = options.getDraft ?? getReceiptDraft;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  options.onPhase?.("uploading");
  let scan = await upload(file);
  options.onPhase?.("analyzing");

  const deadline = now() + timeoutMs;
  while (scan.status !== "draft_ready") {
    if (DEAD_END_STATUSES.has(scan.status)) {
      throw new ReceiptScanFailedError(scan.error);
    }
    if (now() >= deadline) {
      throw new ReceiptPollTimeoutError();
    }
    await sleep(pollIntervalMs);
    scan = await getScan(scan.id);
  }

  const draft = await getDraft(scan.id);
  return { scan, draft };
}
