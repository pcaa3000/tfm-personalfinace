import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { Transaction, categorized } from "../domain/transaction.js";
import { TransactionSplit } from "../domain/transaction-split.js";
import type { AccountValidationPort } from "./ports/account-validation.port.js";
import type { CategoryValidationPort } from "./ports/category-validation.port.js";
import type { Clock } from "./ports/clock.port.js";
import type { PeriodCloseInvalidationPort } from "./ports/period-close-invalidation.port.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "./ports/transaction-repository.port.js";
import { ReviseTransactionUseCase } from "./revise-transaction.use-case.js";

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

const accounts: AccountValidationPort = {
  accountCurrency: async (workspaceId, accountId) => {
    if (workspaceId.value !== "ws-1") return null;
    if (accountId === "acc-1" || accountId === "acc-eur-2") return "EUR";
    if (accountId === "acc-usd") return "USD";
    return null;
  },
};

const categories: CategoryValidationPort = {
  existsForWorkspace: async (_ws, id) => id === "cat-food" || id === "cat-home",
};
const clock: Clock = { now: () => new Date("2026-10-28T12:00:00Z") };

const wsResult = WorkspaceId.create("ws-1");
const otherWsResult = WorkspaceId.create("ws-2");
if (!wsResult.ok || !otherWsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;
const otherWs = otherWsResult.value;

async function makeTransaction(
  options: { transfer?: boolean; splits?: { categoryId: string; amount: string }[] } = {},
): Promise<Transaction> {
  const { Money, BusinessDate } = await import("../../shared-kernel/index.js");
  const amount = Money.create("25.50", "EUR");
  const date = BusinessDate.create("2026-10-27", "UTC");
  if (!amount.ok || !date.ok) throw new Error("setup failed");
  const splits = (options.splits ?? []).map((s) => {
    const splitAmount = Money.create(s.amount, "EUR");
    if (!splitAmount.ok) throw new Error("setup failed");
    const split = TransactionSplit.create({
      categoryId: s.categoryId,
      amount: splitAmount.value,
    });
    if (!split.ok) throw new Error("setup failed");
    return split.value;
  });
  const trx = Transaction.recordManual({ accountId: "acc-1",
    id: "trx-1",
    workspaceId: ws,
    idempotencyKey: "idem-1",
    type: options.transfer ? "transfer" : "expense",
    amount: amount.value,
    businessDate: date.value,
    concept: "Grocery run",
    ...(options.transfer ? { destinationAccountId: "acc-eur-2" } : {}),
    ...(options.transfer ? {} : { category: categorized("cat-food") }),
    splits,
    confirmedAt: new Date("2026-10-27T10:00:00Z"),
    confirmedBy: "subject-1",
  });
  if (!trx.ok) throw new Error("setup failed");
  return trx.value;
}

describe("ReviseTransactionUseCase", () => {
  it("revises editable fields and persists the revision", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Weekly groceries",
      categoryId: "cat-home",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.concept).toBe("Weekly groceries");
    expect(result.value.categoryId).toBe("cat-home");
    expect(result.value.revisionCount).toBe(1);
    expect(repo.saved).toHaveLength(1);
  });

  it("revises amount keeping the stored currency when currency is omitted", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      amount: "30.00",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.amount).toBe("30.00");
    expect(result.value.currency).toBe("EUR");
  });

  it("revises business date keeping the stored timezone when omitted", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      businessDate: "2026-10-26",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.businessDate).toBe("2026-10-26");
    expect(result.value.timezone).toBe("UTC");
  });

  it("assigns the explicit uncategorized state with categoryId null", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      categoryId: null,
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categoryId).toBeNull();
  });

  it("returns TRANSACTION_NOT_FOUND for an unknown id", async () => {
    const repo = new InMemoryTransactions([]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-missing",
      concept: "x",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });

  it("returns TRANSACTION_NOT_FOUND for a transaction of another workspace", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: otherWs,
      transactionId: "trx-1",
      concept: "x",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NOT_FOUND");
    }
  });

  it("rejects an unknown category", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      categoryId: "cat-missing",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects a revision that changes nothing", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Grocery run",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NO_CHANGES");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects revising a voided transaction", async () => {
    const trx = await makeTransaction();
    const voided = trx.void({
      voidedAt: new Date("2026-10-28T11:00:00Z"),
      voidedBy: "subject-1",
    });
    if (!voided.ok) throw new Error("setup failed");
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "x",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_ALREADY_VOIDED");
    }
  });

  it("assigns an account to a legacy accountless transaction (INV-CTA-03)", async () => {
    const trx = await makeTransaction();
    const legacy = Transaction.reconstitute({
      id: trx.id,
      workspaceId: trx.workspaceId,
      idempotencyKey: trx.idempotencyKey,
      type: trx.type,
      amount: trx.amount,
      businessDate: trx.businessDate,
      concept: trx.concept,
      accountId: null,
      category: trx.category,
      status: trx.status,
      origin: trx.origin,
      originReference: trx.originReference,
      confirmedAt: trx.confirmedAt,
      confirmedBy: trx.confirmedBy,
      revisions: [],
    });
    const repo = new InMemoryTransactions([legacy]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      accountId: "acc-1",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accountId).toBe("acc-1");
    expect(result.value.revisionCount).toBe(1);
  });

  it("rejects revising currency when it mismatches the stored account currency (INV-CTA-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      currency: "USD",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects revising accountId to an unknown account (INV-CTA-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      accountId: "acc-missing",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_FOUND");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("revises currency and accountId together when the new account matches (INV-CTA-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      amount: "10.00",
      currency: "USD",
      accountId: "acc-usd",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe("USD");
    expect(result.value.accountId).toBe("acc-usd");
  });

  it("revises an expense to transfer with a valid destinationAccountId (INV-TFR-01..04)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      destinationAccountId: "acc-eur-2",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("transfer");
    expect(result.value.accountId).toBe("acc-1");
    expect(result.value.destinationAccountId).toBe("acc-eur-2");
    expect(result.value.categoryId).toBeNull();
  });

  it("rejects revising to transfer without destinationAccountId (INV-TFR-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_DESTINATION_REQUIRED");
    }
  });

  it("rejects revising to transfer when destination equals source account (INV-TFR-02)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      destinationAccountId: "acc-1",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SAME_ACCOUNT");
    }
  });

  it("rejects revising to transfer when destination account does not exist (INV-TFR-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      destinationAccountId: "acc-missing",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("rejects revising to transfer when destination account currency mismatches (INV-TFR-03)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      destinationAccountId: "acc-usd",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
  });

  it("rejects passing destinationAccountId on an income/expense revision", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      destinationAccountId: "acc-eur-2",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
    }
  });

  it("replaces the split collection and returns it in the view (INV-TRX-SPLIT-01)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      splits: [
        { categoryId: "cat-food", amount: 2000 },
        { categoryId: "cat-home", amount: 550 },
      ],
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.splits).toEqual([
      { categoryId: "cat-food", amount: "20.00" },
      { categoryId: "cat-home", amount: "5.50" },
    ]);
    expect(result.value.revisionCount).toBe(1);
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects a split whose category does not exist in the workspace", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      splits: [{ categoryId: "cat-missing", amount: 2550 }],
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("clears the stored splits when revising with an empty collection", async () => {
    const trx = await makeTransaction({
      splits: [{ categoryId: "cat-food", amount: "25.50" }],
    });
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      splits: [],
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.splits).toEqual([]);
    expect(result.value.revisionCount).toBe(1);
  });

  it("rejects an amount revision that breaks the stored split sum (INV-TRX-SPLIT-01)", async () => {
    const trx = await makeTransaction({
      splits: [{ categoryId: "cat-food", amount: "25.50" }],
    });
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      amount: "30.00",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_SPLITS_SUM_MISMATCH");
    }
    expect(repo.saved).toHaveLength(0);
  });

  it("rejects splits when the effective type is transfer", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      type: "transfer",
      destinationAccountId: "acc-eur-2",
      splits: [{ categoryId: "cat-food", amount: 2550 }],
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SPLITS_FORBIDDEN");
    }
    expect(repo.saved).toHaveLength(0);
  });
});

describe("ReviseTransactionUseCase — period-close staleness (reports-monthly T2, S5)", () => {
  class SpyPeriodCloses implements PeriodCloseInvalidationPort {
    calls: { workspaceId: string; currency: string; businessDate: string }[] =
      [];

    failNext = false;

    async invalidateCovering(
      workspaceId: WorkspaceId,
      currency: string,
      businessDate: string,
    ) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("invalidation failed");
      }
      this.calls.push({
        workspaceId: workspaceId.value,
        currency,
        businessDate,
      });
      return 0;
    }
  }

  it("invalidates closes covering the transaction business date", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const periodCloses = new SpyPeriodCloses();
    const useCase = new ReviseTransactionUseCase(
      repo,
      accounts,
      categories,
      clock,
      periodCloses,
    );

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Corrected",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    expect(periodCloses.calls).toEqual([
      { workspaceId: "ws-1", currency: "EUR", businessDate: "2026-10-27" },
    ]);
  });

  it("does not persist the revision when invalidation fails (invalidate-before-save)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const periodCloses = new SpyPeriodCloses();
    periodCloses.failNext = true;
    const useCase = new ReviseTransactionUseCase(
      repo,
      accounts,
      categories,
      clock,
      periodCloses,
    );

    await expect(
      useCase.execute({
        workspaceId: ws,
        transactionId: "trx-1",
        actor: "subject-1",
        concept: "Revised concept",
      }),
    ).rejects.toThrow("invalidation failed");
    // Nothing was committed: retry replays the invalidation (R4-002).
    expect(repo.saved).toHaveLength(0);
  });

  it("invalidates both periods when the revision moves the business date across months", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const periodCloses = new SpyPeriodCloses();
    const useCase = new ReviseTransactionUseCase(
      repo,
      accounts,
      categories,
      clock,
      periodCloses,
    );

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      businessDate: "2026-11-02",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    expect(periodCloses.calls).toEqual(
      expect.arrayContaining([
        { workspaceId: "ws-1", currency: "EUR", businessDate: "2026-11-02" },
        { workspaceId: "ws-1", currency: "EUR", businessDate: "2026-10-27" },
      ]),
    );
    expect(periodCloses.calls).toHaveLength(2);
  });

  it("does not invalidate when the revision is rejected", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const periodCloses = new SpyPeriodCloses();
    const useCase = new ReviseTransactionUseCase(
      repo,
      accounts,
      categories,
      clock,
      periodCloses,
    );

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Grocery run",
      actor: "subject-1",
    });

    expect(result.ok).toBe(false);
    expect(periodCloses.calls).toHaveLength(0);
  });

  it("keeps working without an invalidation port (unwired composition)", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Corrected",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
  });
});

describe("ReviseTransactionUseCase — merchant (reports-monthly T1, S6)", () => {
  it("recomputes the normalized merchant when the revision changes the concept", async () => {
    const trx = await makeTransaction();
    const repo = new InMemoryTransactions([trx]);
    const useCase = new ReviseTransactionUseCase(repo, accounts, categories, clock);

    const result = await useCase.execute({
      workspaceId: ws,
      transactionId: "trx-1",
      concept: "Bodega S.A.C.",
      actor: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.merchant).toBe("bodega");
    }
  });
});
