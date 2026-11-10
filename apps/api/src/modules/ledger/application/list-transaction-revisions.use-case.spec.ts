import { describe, expect, it } from "vitest";

import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../shared-kernel/index.js";
import { TransactionRevision } from "../domain/transaction-revision.js";
import { Transaction, categorized } from "../domain/transaction.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { ListTransactionRevisionsUseCase } from "./list-transaction-revisions.use-case.js";

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function workspaceId(value: string): WorkspaceId {
  return unwrap(WorkspaceId.create(value));
}

function money(raw: string, currency = "PEN"): Money {
  return unwrap(Money.create(raw, currency));
}

function businessDate(isoDate: string): BusinessDate {
  return unwrap(BusinessDate.create(isoDate, "UTC"));
}

class InMemoryTransactions implements TransactionRepositoryPort {
  constructor(private readonly stored: Transaction[] = []) {}

  async findByIdempotencyKey(_workspaceId: WorkspaceId, _key: string) {
    return null;
  }

  async findById(workspaceId: WorkspaceId, id: string) {
    return (
      this.stored.find(
        (t) => t.id === id && t.workspaceId.equals(workspaceId),
      ) ?? null
    );
  }

  async save() {}

  async list(_workspaceId: WorkspaceId, _filter: TransactionFilter) {
    return this.stored;
  }
}

const ws = workspaceId("ws-1");
const otherWs = workspaceId("ws-2");

function makeTransaction(revisions: TransactionRevision[] = []): Transaction {
  return Transaction.reconstitute({
    id: "trx-1",
    workspaceId: ws,
    idempotencyKey: "idem-1",
    type: "expense",
    amount: money("25.50"),
    businessDate: businessDate("2026-10-27"),
    concept: "Weekly groceries",
    accountId: "acc-1",
    category: categorized("cat-food"),
    status: "confirmed",
    origin: "manual",
    originReference: null,
    confirmedAt: new Date("2026-10-27T10:00:00Z"),
    confirmedBy: "subject-1",
    revisions,
  });
}

function makeRevision(
  revisionNumber: number,
  kind: "revision" | "void",
  occurredAt: string,
  actor: string,
): TransactionRevision {
  return new TransactionRevision(
    `trx-1-rev-${revisionNumber}`,
    "trx-1",
    revisionNumber,
    kind,
    kind === "void"
      ? [{ field: "status", previous: "confirmed", next: "voided" }]
      : [
          {
            field: "concept",
            previous: "Grocery run",
            next: "Weekly groceries",
          },
        ],
    new Date(occurredAt),
    actor,
  );
}

describe("ListTransactionRevisionsUseCase", () => {
  it("returns TRANSACTION_NOT_FOUND when the transaction does not exist", async () => {
    const useCase = new ListTransactionRevisionsUseCase(
      new InMemoryTransactions(),
    );

    const result = await useCase.execute(ws, "trx-missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });

  it("returns TRANSACTION_NOT_FOUND for a transaction of another workspace", async () => {
    const repo = new InMemoryTransactions([makeTransaction()]);
    const useCase = new ListTransactionRevisionsUseCase(repo);

    const result = await useCase.execute(otherWs, "trx-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });

  it("maps stored revisions to TransactionRevisionView preserving order", async () => {
    const trx = makeTransaction([
      makeRevision(1, "revision", "2026-10-28T11:00:00Z", "subject-1"),
      makeRevision(2, "void", "2026-10-29T09:30:00Z", "subject-2"),
    ]);
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ListTransactionRevisionsUseCase(repo);

    const views = unwrap(await useCase.execute(ws, "trx-1"));

    expect(views).toEqual([
      {
        id: "trx-1-rev-1",
        transactionId: "trx-1",
        revisionNumber: 1,
        kind: "revision",
        changes: [
          {
            field: "concept",
            previous: "Grocery run",
            next: "Weekly groceries",
          },
        ],
        occurredAt: "2026-10-28T11:00:00.000Z",
        actor: "subject-1",
      },
      {
        id: "trx-1-rev-2",
        transactionId: "trx-1",
        revisionNumber: 2,
        kind: "void",
        changes: [{ field: "status", previous: "confirmed", next: "voided" }],
        occurredAt: "2026-10-29T09:30:00.000Z",
        actor: "subject-2",
      },
    ]);
  });

  it("returns an empty list when the transaction has no revisions", async () => {
    const repo = new InMemoryTransactions([makeTransaction()]);
    const useCase = new ListTransactionRevisionsUseCase(repo);

    const views = unwrap(await useCase.execute(ws, "trx-1"));

    expect(views).toEqual([]);
  });
});
