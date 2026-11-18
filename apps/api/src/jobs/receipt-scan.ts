import type { CategoryCatalogPort } from "../modules/categorization/index.js";
import type { Clock } from "../modules/ledger/index.js";
import {
  WorkspaceId,
} from "../modules/shared-kernel/index.js";
import type {
  ReceiptScanRepositoryPort,
  ReceiptStoragePort,
  ReceiptScanPort,
} from "../modules/receipts/index.js";
import { buildReceiptDraft } from "../modules/receipts/domain/receipt-draft.js";

/** Job envelope dispatched on the `receipt-scan` queue (payload kept minimal). */
export interface ReceiptScanJob {
  readonly receiptId: string;
  readonly workspaceId: string;
}

export interface ReceiptScanJobDeps {
  readonly scans: ReceiptScanRepositoryPort;
  readonly storage: ReceiptStoragePort;
  readonly categories: CategoryCatalogPort;
  readonly scanner: ReceiptScanPort;
  readonly clock: Clock;
}

/**
 * T4+T5 consumer (S3+S5+S6+S9+S10): pending scan row → storage bytes →
 * workspace catalog → LLM extraction+categorization → grouped draft →
 * `draft_ready`. EVERY failure path marks the row `failed` with its
 * error — the handler never lets an exception escape without persisting
 * a terminal state, and a redelivery of a non-pending row is a no-op
 * (at-least-once idempotence).
 */
export async function handleReceiptScan(
  deps: ReceiptScanJobDeps,
  job: ReceiptScanJob,
): Promise<void> {
  const workspaceId = WorkspaceId.create(job.workspaceId);
  if (!workspaceId.ok) {
    console.error(
      `[receipt-scan] invalid workspaceId ${JSON.stringify(job.workspaceId)} for ${job.receiptId}`,
    );
    return;
  }
  const scan = await deps.scans.findById(workspaceId.value, job.receiptId);
  if (!scan) {
    console.error(`[receipt-scan] scan not found: ${job.receiptId}`);
    return;
  }
  if (scan.status !== "pending") {
    return; // already processed — pg-boss is at-least-once
  }

  try {
    const bytes = await deps.storage.open(scan.storageKey);
    if (bytes === null) {
      scan.markFailed(
        `receipt object missing from storage: ${scan.storageKey}`,
        deps.clock.now(),
      );
      await deps.scans.save(scan);
      return;
    }

    const categories = await deps.categories.listForWorkspace(
      scan.workspaceId,
    );
    const result = await deps.scanner.scan(
      bytes,
      scan.mimeType,
      categories,
    );
    if (!result.ok) {
      scan.markFailed(
        `${result.error.code}: ${result.error.message}`,
        deps.clock.now(),
      );
      await deps.scans.save(scan);
      return;
    }

    const draft = buildReceiptDraft(result.value);
    scan.markDraftReady(result.value, draft, deps.clock.now());
    await deps.scans.save(scan);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      scan.markFailed(`unexpected: ${message}`, deps.clock.now());
      await deps.scans.save(scan);
    } catch (saveError) {
      console.error(
        `[receipt-scan] failed to persist failed state for ${job.receiptId}:`,
        saveError,
      );
    }
  }
}
