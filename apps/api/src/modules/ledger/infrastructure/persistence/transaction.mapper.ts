import type { Prisma } from "@prisma/client";

import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../../shared-kernel/index.js";
import { TransactionRevision, type FieldChange } from "../../domain/transaction-revision.js";
import {
  Transaction,
  UNCATEGORIZED,
  categorized,
  type TransactionOrigin,
  type TransactionStatus,
  type TransactionType,
} from "../../domain/transaction.js";

type TransactionRow = Prisma.TransactionGetPayload<{
  include: { revisions: true };
}>;

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Prisma record → domain aggregate (adapter boundary mapping). */
export function toDomain(row: TransactionRow): Transaction {
  return Transaction.reconstitute({
    id: row.id,
    workspaceId: unwrap(WorkspaceId.create(row.workspaceId)),
    idempotencyKey: row.idempotencyKey,
    type: row.type as TransactionType,
    amount: unwrap(Money.fromMinorUnits(row.amountMinor, row.currency)),
    businessDate: unwrap(
      BusinessDate.create(row.businessDate.toISOString().slice(0, 10), row.timezone),
    ),
    concept: row.concept,
    accountId: row.accountId,
    destinationAccountId: row.destinationAccountId,
    category: row.categoryId ? categorized(row.categoryId) : UNCATEGORIZED,
    status: row.status as TransactionStatus,
    origin: row.origin as TransactionOrigin,
    originReference: row.originRef,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    revisions: row.revisions.map(
      (rev) =>
        new TransactionRevision(
          rev.id,
          rev.transactionId,
          rev.revisionNumber,
          rev.kind as "revision" | "void",
          rev.changes as unknown as FieldChange[],
          rev.occurredAt,
          rev.actor,
        ),
    ),
  });
}
