import type { Clock } from "../../ledger/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { ReceiptMediaPurgePort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";

/**
 * Manual purge windows (receipt-retention-30d T6, S6): the user picks
 * one of 7/15/30 days — "borra los medios más viejos que el plazo
 * elegido". Pinned at the HTTP edge (INVALID_PURGE_WINDOW) and at the
 * type level here, so no other window is representable.
 */
export const RECEIPT_PURGE_WINDOWS = [7, 15, 30] as const;
export type ReceiptPurgeWindow = (typeof RECEIPT_PURGE_WINDOWS)[number];

/**
 * Batch cap per request — same bounded-batch policy as the daily job
 * (S4); a bigger backlog drains over repeated calls.
 */
export const RECEIPT_MANUAL_PURGE_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `POST /api/v1/receipts/purge-media` (receipt-retention-30d T6, S6):
 * deletes the storage object of every scan in the CALLER's workspace
 * whose media is still present and was captured at or before
 * `now - olderThanDays` — by CAPTURE AGE (`createdAt`), unlike the
 * daily cron purge which selects on `expiresAt` cross-workspace (S4).
 * Same per-item policy as the job: storage drivers tolerate absent
 * objects, a per-item failure is logged, leaves the row unmarked for
 * a later retry and does not abort the batch. Returns the number of
 * media actually deleted.
 */
export class PurgeReceiptMediaUseCase {
  constructor(
    private readonly scans: ReceiptMediaPurgePort,
    private readonly storage: ReceiptStoragePort,
    private readonly clock: Clock,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    olderThanDays: ReceiptPurgeWindow,
  ): Promise<number> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);
    const candidates = await this.scans.listMediaPurgeCandidates(
      workspaceId,
      cutoff,
      RECEIPT_MANUAL_PURGE_BATCH_SIZE,
    );

    let deleted = 0;
    for (const candidate of candidates) {
      try {
        await this.storage.delete(candidate.storageKey);
      } catch (cause) {
        console.error(
          `[receipt-media-purge] failed to delete ${candidate.storageKey} for scan ${candidate.id}:`,
          cause,
        );
        continue;
      }
      await this.scans.stampMediaDeleted(candidate.id, now);
      deleted += 1;
    }
    return deleted;
  }
}
