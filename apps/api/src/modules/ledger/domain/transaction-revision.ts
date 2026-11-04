export type RevisionKind = "revision" | "void";

export type RevisionField =
  | "type"
  | "amount"
  | "currency"
  | "businessDate"
  | "concept"
  | "accountId"
  | "destinationAccountId"
  | "category"
  | "status";

export interface FieldChange {
  readonly field: RevisionField;
  readonly previous: string;
  readonly next: string;
}

/**
 * Immutable audit record of one change applied to a transaction.
 * A void never deletes history; it is appended as a revision (INV-TRX-02/03).
 */
export class TransactionRevision {
  constructor(
    readonly id: string,
    readonly transactionId: string,
    readonly revisionNumber: number,
    readonly kind: RevisionKind,
    readonly changes: readonly FieldChange[],
    readonly occurredAt: Date,
    readonly actor: string,
  ) {}
}
