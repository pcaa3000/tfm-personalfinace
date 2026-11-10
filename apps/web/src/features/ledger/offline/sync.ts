import { createTransaction, currentCallerSubject } from "../api";
import {
  listPendingTransactions,
  markSyncAttempt,
  removePendingTransaction,
} from "./queue";

export interface SyncResult {
  synced: number;
  /** Items dropped because they belong to another identity (S6). */
  dropped: number;
  remaining: number;
}

/**
 * Drains the local outbox in enqueue order. Server-side idempotency keys
 * make replay safe: a retried POST for a key that already landed returns
 * the stored transaction instead of duplicating it. Failed items stay
 * queued with their error recorded for the next online attempt.
 *
 * GAP-SEC-08 (S6): items whose bound `ownerSubject` differs from the
 * current caller subject are never sent — sending them would leak
 * another identity's financial data under this session's token (e.g. a
 * queue written under dev bypass before a real login). They are
 * dropped: they belong to the other identity, not to this session.
 */
export async function syncPendingTransactions(): Promise<SyncResult> {
  const pending = await listPendingTransactions();
  const subject = await currentCallerSubject();
  let synced = 0;
  let dropped = 0;
  for (const item of pending) {
    if ((item.ownerSubject ?? null) !== subject) {
      if (subject === null) {
        // Identity unverifiable (no token provider / transient failure):
        // retain the item — never send it anonymously and never destroy
        // data that may belong to the current identity.
        continue;
      }
      await removePendingTransaction(item.idempotencyKey);
      dropped += 1;
      continue;
    }
    try {
      await createTransaction(item.input);
      await removePendingTransaction(item.idempotencyKey);
      synced += 1;
    } catch (error) {
      await markSyncAttempt(item.idempotencyKey, error);
    }
  }
  return { synced, dropped, remaining: pending.length - synced - dropped };
}
