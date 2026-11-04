import { describe, expect, it } from "vitest";

import {
  BusinessDate,
  Money,
  WorkspaceId,
} from "../../shared-kernel/index.js";
import { Transaction, categorized } from "../domain/transaction.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { ListTransactionsUseCase } from "./list-transactions.use-case.js";

class InMemoryTransactions implements TransactionRepositoryPort {
  lastWorkspaceId: WorkspaceId | null = null;
  lastFilter: TransactionFilter | null = null;

  constructor(private readonly stored: Transaction[] = []) {}

  async findByIdempotencyKey(_workspaceId: WorkspaceId, _key: string) {
    return null;
  }
  async findById(_workspaceId: WorkspaceId, _id: string) {
    return null;
  }
  async save(_trx: Transaction) {}
  async list(workspaceId: WorkspaceId, filter: TransactionFilter) {
    this.lastWorkspaceId = workspaceId;
    this.lastFilter = filter;
    return this.stored;
  }
}

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeTransaction(): Transaction {
  const amount = Money.create("25.50", "EUR");
  const date = BusinessDate.create("2026-10-27", "UTC");
  if (!amount.ok || !date.ok) throw new Error("setup failed");
  const trx = Transaction.recordManual({
    accountId: "acc-1",
    id: "trx-1",
    workspaceId: ws,
    idempotencyKey: "idem-1",
    type: "expense",
    amount: amount.value,
    businessDate: date.value,
    concept: "Grocery run",
    category: categorized("cat-food"),
    confirmedAt: new Date("2026-10-27T10:00:00Z"),
    confirmedBy: "subject-1",
  });
  if (!trx.ok) throw new Error("setup failed");
  return trx.value;
}

describe("ListTransactionsUseCase", () => {
  it("forwards workspaceId and the full filter to the repository (RF-013)", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new ListTransactionsUseCase(repo);
    const filter: TransactionFilter = {
      q: "polleria",
      type: "expense",
      currency: "PEN",
      category: "uncategorized",
      from: "2026-10-01",
      to: "2026-10-31",
      limit: 25,
      offset: 50,
    };

    await useCase.execute(ws, filter);

    expect(repo.lastWorkspaceId).toBe(ws);
    expect(repo.lastFilter).toEqual(filter);
  });

  it("returns transactions mapped to TransactionView", async () => {
    const repo = new InMemoryTransactions([makeTransaction()]);
    const useCase = new ListTransactionsUseCase(repo);

    const views = await useCase.execute(ws, {});

    expect(views).toEqual([
      {
        id: "trx-1",
        workspaceId: "ws-1",
        type: "expense",
        amount: "25.50",
        currency: "EUR",
        businessDate: "2026-10-27",
        timezone: "UTC",
        concept: "Grocery run",
        accountId: "acc-1",
        destinationAccountId: null,
        categoryId: "cat-food",
        status: "confirmed",
        origin: "manual",
        confirmedAt: "2026-10-27T10:00:00.000Z",
        revisionCount: 0,
      },
    ]);
  });
});
