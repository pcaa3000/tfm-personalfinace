import { describe, expect, it } from "vitest";

import { BusinessDate, Money, WorkspaceId } from "../../shared-kernel/index.js";
import { Transaction, UNCATEGORIZED } from "../domain/transaction.js";
import type { Clock } from "./ports/clock.port.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { ListTransactionRevisionsUseCase } from "./list-transaction-revisions.use-case.js";
import { VoidTransactionUseCase } from "./void-transaction.use-case.js";

class InMemoryTransactions implements TransactionRepositoryPort {
  saved: Transaction[] = [];

  constructor(private readonly stored: Transaction[] = []) {}

  async findByIdempotencyKey(_workspaceId: WorkspaceId, _key: string) {
    return null;
  }
  async findById(workspaceId: WorkspaceId, id: string) {
    return (
      this.stored.find(
        (t) => t.id === id && t.workspaceId.value === workspaceId.value,
      ) ?? null
    );
  }
  async save(trx: Transaction) {
    this.saved.push(trx);
  }
  async list(_workspaceId: WorkspaceId, _filter: TransactionFilter) {
    return this.stored;
  }
}

const clock: Clock = { now: () => new Date("2026-10-28T12:00:00Z") };

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeTransaction(): Transaction {
  const amount = Money.create("25.50", "EUR");
  const date = BusinessDate.create("2026-10-27", "UTC");
  if (!amount.ok || !date.ok) throw new Error("setup failed");
  const trx = Transaction.recordManual({
    id: "trx-1",
    workspaceId: ws,
    idempotencyKey: "idem-1",
    type: "expense",
    amount: amount.value,
    businessDate: date.value,
    concept: "Grocery run",
    category: UNCATEGORIZED,
    confirmedAt: new Date("2026-10-27T10:00:00Z"),
    confirmedBy: "subject-1",
  });
  if (!trx.ok) throw new Error("setup failed");
  return trx.value;
}

describe("VoidTransactionUseCase", () => {
  it("voids a confirmed transaction and records the void revision", async () => {
    const trx = makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new VoidTransactionUseCase(repo, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("voided");
    expect(result.value.revisionCount).toBe(1);
    expect(repo.saved).toHaveLength(1);
    const voidRevision = trx.revisions[0];
    expect(voidRevision?.kind).toBe("void");
  });

  it("returns the current view when the transaction is already voided", async () => {
    const trx = makeTransaction();
    const voided = trx.void({
      voidedAt: new Date("2026-10-28T11:00:00Z"),
      voidedBy: "subject-1",
    });
    if (!voided.ok) throw new Error("setup failed");
    const repo = new InMemoryTransactions([trx]);
    const useCase = new VoidTransactionUseCase(repo, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("voided");
    expect(result.value.revisionCount).toBe(1);
    expect(repo.saved).toHaveLength(0);
  });

  it("returns TRANSACTION_NOT_FOUND for an unknown id", async () => {
    const repo = new InMemoryTransactions([]);
    const useCase = new VoidTransactionUseCase(repo, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-missing",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });
});

describe("ListTransactionRevisionsUseCase", () => {
  it("returns the revision trail in order", async () => {
    const trx = makeTransaction();
    const revised = trx.revise({
      concept: "Corrected",
      revisedAt: new Date("2026-10-28T10:00:00Z"),
      revisedBy: "subject-1",
    });
    if (!revised.ok) throw new Error("setup failed");
    const voided = trx.void({
      voidedAt: new Date("2026-10-28T11:00:00Z"),
      voidedBy: "subject-1",
    });
    if (!voided.ok) throw new Error("setup failed");
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ListTransactionRevisionsUseCase(repo);

    const result = await useCase.execute(ws, "trx-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.kind).toBe("revision");
    expect(result.value[0]?.changes[0]?.field).toBe("concept");
    expect(result.value[0]?.revisionNumber).toBe(1);
    expect(result.value[1]?.kind).toBe("void");
    expect(result.value[1]?.revisionNumber).toBe(2);
    expect(result.value[1]?.actor).toBe("subject-1");
  });

  it("returns TRANSACTION_NOT_FOUND for an unknown id", async () => {
    const repo = new InMemoryTransactions([]);
    const useCase = new ListTransactionRevisionsUseCase(repo);

    const result = await useCase.execute(ws, "trx-missing");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });
});
