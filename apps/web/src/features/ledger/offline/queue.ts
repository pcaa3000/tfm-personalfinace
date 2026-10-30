import Dexie, { type EntityTable } from "dexie";

import type { CreateTransactionInput } from "../types";

/**
 * Local outbox (IndexedDB via Dexie): manual transactions created while
 * offline wait here until the sync manager drains them. `seq` preserves
 * true insertion order; the unique idempotencyKey makes re-enqueueing a
 * no-op, and the server replays the key idempotently if the first
 * response was lost.
 */
export interface PendingTransaction {
  seq?: number;
  idempotencyKey: string;
  input: CreateTransactionInput;
  enqueuedAt: string; // ISO instant
  attempts: number;
  lastError: string | null;
}

export const ledgerDb = new Dexie("tfm-ledger") as Dexie & {
  pendingTransactions: EntityTable<PendingTransaction, "seq">;
};

ledgerDb.version(1).stores({
  pendingTransactions: "++seq, &idempotencyKey",
});

export async function enqueueTransaction(
  input: CreateTransactionInput,
): Promise<void> {
  const existing = await ledgerDb.pendingTransactions
    .where("idempotencyKey")
    .equals(input.idempotencyKey)
    .first();
  if (existing) {
    return; // first enqueue wins — mirrors server-side idempotent replay
  }
  await ledgerDb.pendingTransactions.add({
    idempotencyKey: input.idempotencyKey,
    input,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  });
}

export async function listPendingTransactions(): Promise<PendingTransaction[]> {
  return ledgerDb.pendingTransactions.orderBy("seq").toArray();
}

export async function removePendingTransaction(
  idempotencyKey: string,
): Promise<void> {
  await ledgerDb.pendingTransactions
    .where("idempotencyKey")
    .equals(idempotencyKey)
    .delete();
}

export async function markSyncAttempt(
  idempotencyKey: string,
  error: unknown,
): Promise<void> {
  await ledgerDb.pendingTransactions
    .where("idempotencyKey")
    .equals(idempotencyKey)
    .modify((item) => {
      item.attempts += 1;
      item.lastError = error instanceof Error ? error.message : String(error);
    });
}
