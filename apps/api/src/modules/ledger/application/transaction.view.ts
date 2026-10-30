import type { Transaction } from "../domain/transaction.js";

/** Flat, serializable read model returned by ledger use cases. */
export interface TransactionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: "income" | "expense";
  readonly amount: string; // decimal string, never a float
  readonly currency: string;
  readonly businessDate: string; // YYYY-MM-DD
  readonly timezone: string;
  readonly concept: string;
  readonly accountId: string | null; // null = legacy pre-accounts row
  readonly categoryId: string | null; // null = uncategorized
  readonly status: "confirmed" | "voided";
  readonly origin: "manual" | "ticket" | "voice";
  readonly confirmedAt: string; // ISO instant
  readonly revisionCount: number;
}

export function toTransactionView(trx: Transaction): TransactionView {
  return {
    id: trx.id,
    workspaceId: trx.workspaceId.value,
    type: trx.type,
    amount: trx.amount.toDecimalString(),
    currency: trx.amount.currency.code,
    businessDate: trx.businessDate.isoDate,
    timezone: trx.businessDate.timezone,
    concept: trx.concept,
    accountId: trx.accountId,
    categoryId:
      trx.category.kind === "categorized" ? trx.category.categoryId : null,
    status: trx.status,
    origin: trx.origin,
    confirmedAt: trx.confirmedAt.toISOString(),
    revisionCount: trx.revisions.length,
  };
}
