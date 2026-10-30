import { createTransaction } from "../api";
import {
  listPendingTransactions,
  markSyncAttempt,
  removePendingTransaction,
} from "./queue";

export interface SyncResult {
  synced: number;
  remaining: number;
}

/**
 * Drains the local outbox in enqueue order. Server-side idempotency keys
 * make replay safe: a retried POST for a key that already landed returns
 * the stored transaction instead of duplicating it. Failed items stay
 * queued with their error recorded for the next online attempt.
 */
export async function syncPendingTransactions(): Promise<SyncResult> {
  const pending = await listPendingTransactions();
  let synced = 0;
  for (const item of pending) {
    try {
      await createTransaction(item.input);
      await removePendingTransaction(item.idempotencyKey);
      synced += 1;
    } catch (error) {
      await markSyncAttempt(item.idempotencyKey, error);
    }
  }
  return { synced, remaining: pending.length - synced };
}
