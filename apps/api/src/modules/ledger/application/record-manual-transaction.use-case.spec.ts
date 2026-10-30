import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { AccountValidationPort } from "./ports/account-validation.port.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";
import type { Clock } from "./ports/clock.port.js";
import type { IdGenerator } from "./ports/id-generator.port.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { RecordManualTransactionUseCase } from "./record-manual-transaction.use-case.js";
import type { Transaction } from "../domain/transaction.js";

class InMemoryTransactions implements TransactionRepositoryPort {
  saved: Transaction[] = [];
  private byKey = new Map<string, Transaction>();

  async findByIdempotencyKey(workspaceId: WorkspaceId, key: string) {
    return this.byKey.get(`${workspaceId.value}:${key}`) ?? null;
  }
  async findById(workspaceId: WorkspaceId, id: string) {
    return this.saved.find((t) => t.id === id) ?? null;
  }
  async save(trx: Transaction) {
    this.saved.push(trx);
    this.byKey.set(`${trx.workspaceId.value}:${trx.idempotencyKey}`, trx);
  }
  async list(_workspaceId: WorkspaceId, _filter: TransactionFilter) {
    return this.saved;
  }
}

const accounts: AccountValidationPort = {
  accountCurrency: async (_ws, id) => (id === "acc-1" ? "EUR" : null),
};

const categories: CategoryValidationPort = {
  existsForWorkspace: async (_ws, id) => id === "cat-food",
};
const clock: Clock = { now: () => new Date("2026-10-27T12:00:00Z") };
const ids: IdGenerator = { next: () => "trx-generated" };

const ws = WorkspaceId.create("ws-1");
if (!ws.ok) throw new Error("setup failed");

const command = {
  accountId: "acc-1",
  workspaceId: ws.value,
  idempotencyKey: "idem-1",
  type: "expense" as const,
  amount: "25.50",
  currency: "EUR",
  businessDate: "2026-10-27",
  timezone: "UTC",
  concept: "Grocery run",
  categoryId: "cat-food",
  actor: "subject-1",
};

describe("RecordManualTransactionUseCase", () => {
  it("records and saves a confirmed transaction", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute(command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("trx-generated");
    expect(result.value.amount).toBe("25.50");
    expect(result.value.status).toBe("confirmed");
    expect(result.value.confirmedAt).toBe("2026-10-27T12:00:00.000Z");
    expect(repo.saved).toHaveLength(1);
  });

  it("returns the existing transaction on an idempotent replay", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);
    const first = await useCase.execute(command);
    if (!first.ok) throw new Error("setup failed");

    const second = await useCase.execute({ ...command, concept: "Different concept" });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.id).toBe(first.value.id);
    }
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects an unknown category", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute({ ...command, categoryId: "cat-missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a non-positive amount", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute({ ...command, amount: "0" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_AMOUNT_NOT_POSITIVE");
    }
  });

  it("rejects a transaction for an unknown account", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute({ ...command, accountId: "acc-missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_FOUND");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a transaction whose currency differs from the account", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute({ ...command, currency: "USD" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("accepts an explicit uncategorized transaction", async () => {
    const repo = new InMemoryTransactions();
    const useCase = new RecordManualTransactionUseCase(repo, accounts, categories, clock, ids);

    const result = await useCase.execute({ ...command, categoryId: null });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.categoryId).toBeNull();
    }
  });
});
