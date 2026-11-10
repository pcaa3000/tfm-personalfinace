import { createTransaction } from "../api";
import type { CreateTransactionInput, LedgerRow } from "../types";
import { enqueueTransaction, type PendingTransaction } from "./queue";

/** fetch rejects with TypeError on network failure (offline, DNS, refused). */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/** Synthetic row shown while the record waits in the local outbox. */
export function toPendingView(item: PendingTransaction): LedgerRow {
  return {
    id: `pending:${item.idempotencyKey}`,
    workspaceId: "",
    type: item.input.type,
    amount: item.input.amount,
    currency: item.input.currency,
    businessDate: item.input.businessDate,
    accountId: item.input.accountId,
    destinationAccountId: item.input.destinationAccountId ?? null,
    timezone: item.input.timezone,
    concept: item.input.concept,
    categoryId: item.input.categoryId,
    status: "confirmed",
    origin: "manual",
    confirmedAt: item.enqueuedAt,
    revisionCount: 0,
    pendingSync: true,
  };
}

/**
 * Creates a transaction, falling back to the local outbox when the network
 * is unreachable. Server validation errors still throw — only a genuine
 * connectivity failure turns into a queued "pending sync" record.
 */
export async function createTransactionOrQueue(
  input: CreateTransactionInput,
): Promise<LedgerRow> {
  try {
    return await createTransaction(input);
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }
    return toPendingView(await enqueueTransaction(input));
  }
}
