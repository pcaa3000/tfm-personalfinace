import type {
  FieldChange,
  TransactionRevision,
} from "../domain/transaction-revision.js";

/** Flat, serializable read model of one audited change. */
export interface TransactionRevisionView {
  readonly id: string;
  readonly transactionId: string;
  readonly revisionNumber: number;
  readonly kind: "revision" | "void";
  readonly changes: readonly FieldChange[];
  readonly occurredAt: string; // ISO instant
  readonly actor: string;
}

export function toTransactionRevisionView(
  revision: TransactionRevision,
): TransactionRevisionView {
  return {
    id: revision.id,
    transactionId: revision.transactionId,
    revisionNumber: revision.revisionNumber,
    kind: revision.kind,
    changes: revision.changes,
    occurredAt: revision.occurredAt.toISOString(),
    actor: revision.actor,
  };
}
