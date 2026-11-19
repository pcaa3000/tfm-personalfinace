import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  type SQL,
} from "drizzle-orm";

import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../../shared-kernel/index.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "../../application/ports/transaction-repository.port.js";
import {
  Transaction,
  UNCATEGORIZED,
  categorized,
  type TransactionOrigin,
  type TransactionStatus,
  type TransactionType,
} from "../../domain/transaction.js";
import { TransactionRevision, type FieldChange } from "../../domain/transaction-revision.js";
import { TransactionSplit } from "../../domain/transaction-split.js";
import {
  ledgerTransactionRevisions,
  ledgerTransactionSplits,
  ledgerTransactions,
} from "../../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../../drizzle/db.js";
import { insertOutboxEvent } from "../../../../drizzle/outbox.js";

type TransactionRow = typeof ledgerTransactions.$inferSelect;
type RevisionRow = typeof ledgerTransactionRevisions.$inferSelect;
type SplitRow = typeof ledgerTransactionSplits.$inferSelect;

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Drizzle row → domain aggregate (mirrors transaction.mapper.ts toDomain). */
function toDomain(
  row: TransactionRow,
  revisions: RevisionRow[],
  splits: SplitRow[],
): Transaction {
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
    revisions: revisions.map(
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
    splits: splits.map(
      (split) =>
        TransactionSplit.reconstitute({
          categoryId: split.categoryId,
          amount: unwrap(Money.fromMinorUnits(split.amountMinor, row.currency)),
        }),
    ),
  });
}

async function loadWithRevisions(
  db: DrizzleDb,
  rows: TransactionRow[],
): Promise<Transaction[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((r) => r.id);
  const revisions = await db
    .select()
    .from(ledgerTransactionRevisions)
    .where(inArray(ledgerTransactionRevisions.transactionId, ids))
    .orderBy(asc(ledgerTransactionRevisions.revisionNumber));
  const splits = await db
    .select()
    .from(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.transactionId, ids))
    .orderBy(asc(ledgerTransactionSplits.position));
  const byTransaction = new Map<string, RevisionRow[]>();
  for (const rev of revisions) {
    const list = byTransaction.get(rev.transactionId) ?? [];
    list.push(rev);
    byTransaction.set(rev.transactionId, list);
  }
  const splitsByTransaction = new Map<string, SplitRow[]>();
  for (const split of splits) {
    const list = splitsByTransaction.get(split.transactionId) ?? [];
    list.push(split);
    splitsByTransaction.set(split.transactionId, list);
  }
  return rows.map((row) =>
    toDomain(
      row,
      byTransaction.get(row.id) ?? [],
      splitsByTransaction.get(row.id) ?? [],
    ),
  );
}

/**
 * Drizzle implementation of {@link TransactionRepositoryPort} (spike T2).
 * Mirrors PrismaTransactionRepository semantics against the same physical
 * tables defined in src/drizzle/schema.ts.
 */
export class DrizzleTransactionRepository implements TransactionRepositoryPort {
  constructor(private readonly db: DrizzleDb) {}

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Transaction | null> {
    const rows = await this.db
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, workspaceId.value),
          eq(ledgerTransactions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const [transaction] = await loadWithRevisions(this.db, [row]);
    return transaction ?? null;
  }

  async findById(workspaceId: WorkspaceId, id: string): Promise<Transaction | null> {
    const rows = await this.db
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.id, id),
          eq(ledgerTransactions.workspaceId, workspaceId.value),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const [transaction] = await loadWithRevisions(this.db, [row]);
    return transaction ?? null;
  }

  async save(transaction: Transaction): Promise<void> {
    const latest = transaction.revisions[transaction.revisions.length - 1];
    await this.db.transaction(async (tx) => {
      await tx
        .insert(ledgerTransactions)
        .values({
          id: transaction.id,
          workspaceId: transaction.workspaceId.value,
          idempotencyKey: transaction.idempotencyKey,
          type: transaction.type,
          amountMinor: transaction.amount.minorUnits,
          currency: transaction.amount.currency.code,
          businessDate: new Date(`${transaction.businessDate.isoDate}T00:00:00Z`),
          timezone: transaction.businessDate.timezone,
          concept: transaction.concept,
          accountId: transaction.accountId,
          destinationAccountId: transaction.destinationAccountId,
          categoryId:
            transaction.category.kind === "categorized"
              ? transaction.category.categoryId
              : null,
          status: transaction.status,
          origin: transaction.origin,
          originRef: transaction.originReference,
          confirmedAt: transaction.confirmedAt,
          confirmedBy: transaction.confirmedBy,
        })
        .onConflictDoUpdate({
          target: ledgerTransactions.id,
          set: {
            type: transaction.type,
            amountMinor: transaction.amount.minorUnits,
            currency: transaction.amount.currency.code,
            businessDate: new Date(`${transaction.businessDate.isoDate}T00:00:00Z`),
            timezone: transaction.businessDate.timezone,
            concept: transaction.concept,
            accountId: transaction.accountId,
            destinationAccountId: transaction.destinationAccountId,
            categoryId:
              transaction.category.kind === "categorized"
                ? transaction.category.categoryId
                : null,
            status: transaction.status,
          },
        });
      // Splits are a child collection replaced wholesale on each save:
      // delete-then-insert keeps stored order (position) in sync with the
      // aggregate and removes rows for splits cleared by a revision.
      await tx
        .delete(ledgerTransactionSplits)
        .where(eq(ledgerTransactionSplits.transactionId, transaction.id));
      if (transaction.splits.length > 0) {
        await tx.insert(ledgerTransactionSplits).values(
          transaction.splits.map((split, position) => ({
            id: randomUUID(),
            transactionId: transaction.id,
            categoryId: split.categoryId,
            amountMinor: split.amount.minorUnits,
            position,
          })),
        );
      }
      if (latest) {
        await tx
          .insert(ledgerTransactionRevisions)
          .values({
            id: randomUUID(),
            transactionId: transaction.id,
            revisionNumber: latest.revisionNumber,
            kind: latest.kind,
            changes: latest.changes as unknown[],
            occurredAt: latest.occurredAt,
            actor: latest.actor,
          })
          .onConflictDoNothing();
      }
      // Transactional outbox (worker-pgboss T2/S1): the event commits or
      // rolls back with the business write — the worker drains it later.
      await insertOutboxEvent(tx, {
        workspaceId: transaction.workspaceId.value,
        type:
          transaction.status === "voided"
            ? "transaction.voided"
            : transaction.revisions.length > 0
              ? "transaction.revised"
              : "transaction.confirmed",
        payload: {
          transactionId: transaction.id,
          type: transaction.type,
          concept: transaction.concept,
          amount: transaction.amount.toDecimalString(),
          currency: transaction.amount.currency.code,
          businessDate: transaction.businessDate.isoDate,
        },
      });
    });
  }

  async list(
    workspaceId: WorkspaceId,
    filter: TransactionFilter,
  ): Promise<Transaction[]> {
    const conditions: SQL[] = [
      eq(ledgerTransactions.workspaceId, workspaceId.value),
    ];
    if (filter.from || filter.to) {
      conditions.push(
        gte(
          ledgerTransactions.businessDate,
          new Date(`${filter.from ?? "0001-01-01"}T00:00:00Z`),
        ),
        lte(
          ledgerTransactions.businessDate,
          new Date(`${filter.to ?? "9999-12-31"}T23:59:59.999Z`),
        ),
      );
    }
    if (filter.type) {
      conditions.push(eq(ledgerTransactions.type, filter.type));
    }
    if (filter.currency) {
      conditions.push(eq(ledgerTransactions.currency, filter.currency));
    }
    if (filter.category === "uncategorized") {
      conditions.push(isNull(ledgerTransactions.categoryId));
    } else if (filter.category) {
      conditions.push(eq(ledgerTransactions.categoryId, filter.category));
    }
    if (filter.q) {
      conditions.push(ilike(ledgerTransactions.concept, `%${filter.q}%`));
    }

    let query = this.db
      .select()
      .from(ledgerTransactions)
      .where(and(...conditions))
      .orderBy(
        desc(ledgerTransactions.businessDate),
        desc(ledgerTransactions.createdAt),
      )
      .$dynamic();
    if (filter.limit !== undefined) {
      query = query.limit(filter.limit);
    }
    if (filter.offset !== undefined) {
      query = query.offset(filter.offset);
    }
    const rows = await query;
    return loadWithRevisions(this.db, rows);
  }
}
