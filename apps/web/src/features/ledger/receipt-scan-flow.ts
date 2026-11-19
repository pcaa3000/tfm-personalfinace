import { getReceiptDraft, getReceiptScan, uploadReceipt } from "./api";
import type { ReceiptDraftPayload, ReceiptScanView } from "./receipt-draft";

/**
 * Upload → poll → draft orchestration (receipt-scan-drafts T7, S1+S2).
 * The API is async: `POST /receipts` returns a `pending` scan and a
 * worker extracts + categorizes; the web polls `GET /receipts/:id`
 * until `draft_ready`, then loads `GET /receipts/:id/draft`.
 *
 * T12 (S11): polling is split from upload so a retry NEVER re-uploads
 * the image — a poll timeout resumes `awaitDraft` over the same scan,
 * and a `failed` scan first calls `POST /receipts/:id/retry` to reset
 * it server-side, then resumes the same polling.
 */

/** The pipeline reported a dead-end terminal status for the scan. */
export class ReceiptScanFailedError extends Error {
  readonly scanError: string | null;
  readonly scanId: string;

  constructor(scanError: string | null, scanId: string) {
    super(scanError ?? "Receipt scan failed");
    this.name = "ReceiptScanFailedError";
    this.scanError = scanError;
    this.scanId = scanId;
  }
}

/** The scan stayed non-terminal beyond the polling budget. */
export class ReceiptPollTimeoutError extends Error {
  readonly scanId: string;

  constructor(scanId: string) {
    super("Receipt scan polling timed out");
    this.name = "ReceiptPollTimeoutError";
    this.scanId = scanId;
  }
}

export type ReceiptFlowPhase = "uploading" | "analyzing";

/** Polling options shared by uploadAndAwaitDraft and awaitDraft. */
export interface AwaitDraftOptions {
  /** Poll cadence — defaults to ~2s. */
  pollIntervalMs?: number;
  /** Overall polling budget — defaults to ~60s. */
  timeoutMs?: number;
  onPhase?: (phase: ReceiptFlowPhase) => void;
  /** Latest scan observed (upload response + every poll) — lets the
   * caller keep the scanId needed to retry without re-uploading. */
  onScan?: (scan: ReceiptScanView) => void;
  getScan?: (id: string) => Promise<ReceiptScanView>;
  getDraft?: (id: string) => Promise<ReceiptDraftPayload>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface UploadAndAwaitDraftOptions extends AwaitDraftOptions {
  upload?: (file: File) => Promise<ReceiptScanView>;
}

/** Terminal statuses where polling stops without a draft. */
const DEAD_END_STATUSES = new Set(["failed", "confirmed", "rejected"]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls an existing scan until the draft is ready (T12, S11). The
 * caller passes the latest scan view it has — the upload response or
 * the retry endpoint's reset row — and polling continues over the same
 * scan id. Timeout and failure errors carry `scanId` so a retry can
 * resume without the view.
 */
export async function awaitDraft(
  initialScan: ReceiptScanView,
  options: AwaitDraftOptions = {},
): Promise<{ scan: ReceiptScanView; draft: ReceiptDraftPayload }> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const getScan = options.getScan ?? getReceiptScan;
  const getDraft = options.getDraft ?? getReceiptDraft;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  options.onPhase?.("analyzing");
  const deadline = now() + timeoutMs;
  let scan = initialScan;
  options.onScan?.(scan);
  while (scan.status !== "draft_ready") {
    if (DEAD_END_STATUSES.has(scan.status)) {
      throw new ReceiptScanFailedError(scan.error, scan.id);
    }
    if (now() >= deadline) {
      throw new ReceiptPollTimeoutError(scan.id);
    }
    await sleep(pollIntervalMs);
    scan = await getScan(scan.id);
    options.onScan?.(scan);
  }

  const draft = await getDraft(scan.id);
  return { scan, draft };
}

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
  const upload = options.upload ?? uploadReceipt;

  options.onPhase?.("uploading");
  const scan = await upload(file);
  return awaitDraft(scan, options);
}
