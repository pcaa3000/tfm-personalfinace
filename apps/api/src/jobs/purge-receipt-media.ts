import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { DrizzleDb } from "../drizzle/db.js";
import { receiptScans } from "../drizzle/schema.js";
import type { Clock } from "../modules/ledger/index.js";
import type { ReceiptStoragePort } from "../modules/receipts/index.js";

/**
 * Daily purge queue (receipt-retention-30d T4, S4): the worker schedules
 * this on pg-boss; the handler deletes expired media objects.
 */
export const RECEIPT_MEDIA_PURGE_QUEUE = "receipt-media-purge";

/** Daily at 03:17 UTC — off the top of the hour like every sane cron. */
export const RECEIPT_MEDIA_PURGE_CRON = "17 3 * * *";

/** Batch cap per run — a backlog drains over consecutive runs (S4). */
export const RECEIPT_PURGE_BATCH_SIZE = 100;

export interface PurgeReceiptMediaDeps {
  readonly db: DrizzleDb;
  readonly storage: ReceiptStoragePort;
  readonly clock: Clock;
}

/**
 * Deletes the storage object of every scan whose media expired
 * (`expiresAt <= now`) and is still present (`mediaDeletedAt IS NULL`),
 * then stamps the marker (CA-012: the scan row survives). Idempotent —
 * storage drivers tolerate absent objects and already-marked rows are
 * never selected. A per-item storage failure is logged, leaves the row
 * unmarked for the next run and does not abort the batch.
 */
export async function purgeExpiredReceiptMedia(
  deps: PurgeReceiptMediaDeps,
  limit = RECEIPT_PURGE_BATCH_SIZE,
): Promise<number> {
  const now = deps.clock.now();
  const expired = await deps.db
    .select({ id: receiptScans.id, storageKey: receiptScans.storageKey })
    .from(receiptScans)
    .where(
      and(
        lte(receiptScans.expiresAt, now),
        isNull(receiptScans.mediaDeletedAt),
      ),
    )
    .orderBy(asc(receiptScans.expiresAt))
    .limit(limit);

  let purged = 0;
  for (const row of expired) {
    try {
      await deps.storage.delete(row.storageKey);
    } catch (cause) {
      console.error(
        `[receipt-media-purge] failed to delete ${row.storageKey} for scan ${row.id}:`,
        cause,
      );
      continue;
    }
    // Guard the update: a concurrent early user DELETE or a second
    // worker may have marked the row meanwhile — never overwrite it.
    await deps.db
      .update(receiptScans)
      .set({ mediaDeletedAt: now, updatedAt: now })
      .where(
        and(eq(receiptScans.id, row.id), isNull(receiptScans.mediaDeletedAt)),
      );
    purged += 1;
  }
  return purged;
}
