import { describe, expect, it } from "vitest";

import {
  BusinessDate,
  Money,
  WorkspaceId,
} from "../../shared-kernel/index.js";
import {
  Transaction,
  UNCATEGORIZED,
  categorized,
} from "./transaction.js";
import { TransactionSplit } from "./transaction-split.js";

const workspaceId = WorkspaceId.create("ws-1");
if (!workspaceId.ok) throw new Error("setup failed");

const businessDate = BusinessDate.create("2026-10-27", "UTC");
if (!businessDate.ok) throw new Error("setup failed");

const amount = Money.create("25.50", "EUR");
if (!amount.ok) throw new Error("setup failed");

const baseInput = {
  id: "trx-1",
  workspaceId: workspaceId.value,
  idempotencyKey: "idem-1",
  type: "expense" as const,
  amount: amount.value,
  businessDate: businessDate.value,
  concept: "Grocery run",
  accountId: "acc-1",
  category: categorized("cat-food"),
  confirmedAt: new Date("2026-10-27T12:00:00Z"),
  confirmedBy: "subject-1",
};

function eur(raw: string): Money {
  const result = Money.create(raw, "EUR");
  if (!result.ok) throw new Error("setup failed");
  return result.value;
}

function split(categoryId: string, raw: string): TransactionSplit {
  const result = TransactionSplit.create({ categoryId, amount: eur(raw) });
  if (!result.ok) throw new Error("setup failed");
  return result.value;
}

describe("TransactionSplit.create", () => {
  it.each(["0", "-5", "0.00"])(
    "rejects non-positive split amount %s (INV-TRX-SPLIT-01)",
    (raw) => {
      const result = TransactionSplit.create({
        categoryId: "cat-food",
        amount: eur(raw),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TRANSACTION_SPLIT_AMOUNT_NOT_POSITIVE");
      }
    },
  );

  it.each(["", "   "])("rejects empty categoryId %j", (categoryId) => {
    const result = TransactionSplit.create({
      categoryId,
      amount: eur("5.00"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_SPLIT_CATEGORY_REQUIRED");
    }
  });
});

describe("Transaction.recordManual splits (INV-TRX-SPLIT-01)", () => {
  it("records a transaction with splits whose sum equals the amount", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "20.00"), split("cat-home", "5.50")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const splits = result.value.splits;
    expect(splits).toHaveLength(2);
    expect(splits[0]?.categoryId).toBe("cat-food");
    expect(splits[0]?.amount.minorUnits).toBe(2000n);
    expect(splits[1]?.categoryId).toBe("cat-home");
    expect(splits[1]?.amount.minorUnits).toBe(550n);
  });

  it("defaults to no splits when none are provided", () => {
    const result = Transaction.recordManual(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.splits).toEqual([]);
    }
  });

  it.each(["25.49", "25.51", "30.00"])(
    "rejects splits whose sum does not equal the amount (total 20.00 + %s)",
    (raw) => {
      const result = Transaction.recordManual({
        ...baseInput,
        splits: [split("cat-food", "20.00"), split("cat-home", raw)],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TRANSACTION_SPLITS_SUM_MISMATCH");
      }
    },
  );

  it("rejects a split in a different currency than the transaction", () => {
    const usd = Money.create("25.50", "USD");
    if (!usd.ok) throw new Error("setup failed");
    const wrong = TransactionSplit.create({
      categoryId: "cat-food",
      amount: usd.value,
    });
    if (!wrong.ok) throw new Error("setup failed");

    const result = Transaction.recordManual({
      ...baseInput,
      splits: [wrong.value],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_SPLIT_CURRENCY_MISMATCH");
    }
  });

  it("rejects splits on a transfer transaction", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
      accountId: "acc-1",
      destinationAccountId: "acc-2",
      splits: [split("cat-food", "25.50")],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SPLITS_FORBIDDEN");
    }
  });
});

describe("Transaction.revise splits (INV-TRX-SPLIT-01)", () => {
  it("replaces the split collection and records the audited change", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "20.00"), split("cat-home", "5.50")],
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      splits: [split("cat-food", "25.50")],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changes).toEqual([
      {
        field: "splits",
        previous: "cat-food=20.00+cat-home=5.50",
        next: "cat-food=25.50",
      },
    ]);
    expect(trx.splits).toHaveLength(1);
    expect(trx.splits[0]?.amount.minorUnits).toBe(2550n);
  });

  it("validates splits against the revised amount when both change together", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const mismatch = trx.revise({
      amount: eur("30.00"),
      splits: [split("cat-food", "25.50")],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe("TRANSACTION_SPLITS_SUM_MISMATCH");
    }

    const valid = trx.revise({
      amount: eur("30.00"),
      splits: [split("cat-food", "30.00")],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(trx.amount.toDecimalString()).toBe("30.00");
      expect(trx.splits).toHaveLength(1);
    }
  });

  it("clears the splits when revising with an empty collection", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "25.50")],
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      splits: [],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changes).toEqual([
      { field: "splits", previous: "cat-food=25.50", next: "none" },
    ]);
    expect(trx.splits).toEqual([]);
  });

  it("treats an identical split collection as no change", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "20.00"), split("cat-home", "5.50")],
    });
    if (!created.ok) throw new Error("setup failed");

    const result = created.value.revise({
      splits: [split("cat-food", "20.00"), split("cat-home", "5.50")],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NO_CHANGES");
    }
  });

  it("rejects revising the amount alone when stored splits no longer sum to it", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "20.00"), split("cat-home", "5.50")],
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      amount: eur("30.00"),
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_SPLITS_SUM_MISMATCH");
    }
    expect(trx.amount.toDecimalString()).toBe("25.50");
  });

  it("rejects revising to transfer while the transaction still has splits", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "25.50")],
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      type: "transfer",
      destinationAccountId: "acc-2",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SPLITS_FORBIDDEN");
    }
  });

  it("rejects non-empty splits on a revision of a transfer", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
      accountId: "acc-1",
      destinationAccountId: "acc-2",
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      splits: [split("cat-food", "25.50")],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SPLITS_FORBIDDEN");
    }
  });

  it("allows revising to transfer when splits are cleared in the same revision", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      splits: [split("cat-food", "25.50")],
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      type: "transfer",
      destinationAccountId: "acc-2",
      splits: [],
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trx.type).toBe("transfer");
    expect(trx.splits).toEqual([]);
    expect(result.value.changes).toEqual(
      expect.arrayContaining([
        { field: "splits", previous: "cat-food=25.50", next: "none" },
      ]),
    );
  });

  it("rejects splits on a voided transaction before validating them", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;
    trx.void({ voidedAt: new Date(), voidedBy: "subject-1" });

    const result = trx.revise({
      splits: [split("cat-food", "99.99")],
      revisedAt: new Date(),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_ALREADY_VOIDED");
    }
  });
});

describe("Transaction.recordManual", () => {
  it("creates a confirmed transaction", () => {
    const result = Transaction.recordManual(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trx = result.value;
    expect(trx.status).toBe("confirmed");
    expect(trx.type).toBe("expense");
    expect(trx.amount.toDecimalString()).toBe("25.50");
    expect(trx.amount.currency.code).toBe("EUR");
    expect(trx.concept).toBe("Grocery run");
    expect(trx.accountId).toBe("acc-1");
    expect(trx.destinationAccountId).toBeNull();
    expect(trx.category).toEqual({ kind: "categorized", categoryId: "cat-food" });
    expect(trx.origin).toBe("manual");
    expect(trx.workspaceId.equals(workspaceId.value)).toBe(true);
    expect(trx.revisions).toHaveLength(0);
  });

  it("supports income type", () => {
    const result = Transaction.recordManual({ ...baseInput, type: "income" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("income");
    }
  });

  it.each(["0", "-10", "0.00"])("rejects non-positive amount %s", (raw) => {
    const bad = Money.create(raw, "EUR");
    if (!bad.ok) throw new Error("setup failed");

    const result = Transaction.recordManual({ ...baseInput, amount: bad.value });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_AMOUNT_NOT_POSITIVE");
    }
  });

  it.each(["", "   "])("rejects empty concept %j", (concept) => {
    const result = Transaction.recordManual({ ...baseInput, concept });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_INVALID_CONCEPT");
    }
  });

  it("accepts the explicit uncategorized assignment", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      category: UNCATEGORIZED,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toEqual({ kind: "uncategorized" });
    }
  });

  it("creates a transfer with destinationAccountId and forces uncategorized (INV-TFR-01, INV-TFR-04)", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
      accountId: "acc-1",
      destinationAccountId: "acc-2",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("transfer");
    expect(result.value.accountId).toBe("acc-1");
    expect(result.value.destinationAccountId).toBe("acc-2");
    expect(result.value.category).toEqual(UNCATEGORIZED);
  });

  it("rejects a transfer without destinationAccountId (INV-TFR-01)", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_DESTINATION_REQUIRED");
    }
  });

  it("rejects a transfer when destinationAccountId equals source accountId (INV-TFR-02)", () => {
    const result = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
      accountId: "acc-1",
      destinationAccountId: "acc-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SAME_ACCOUNT");
    }
  });

  it.each(["income", "expense"] as const)(
    "rejects destinationAccountId when type is %s",
    (type) => {
      const result = Transaction.recordManual({
        ...baseInput,
        type,
        destinationAccountId: "acc-2",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
      }
    },
  );
});

describe("Transaction.revise", () => {
  it("records a revision with field-level changes", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;
    const newAmount = Money.create("30", "EUR");
    if (!newAmount.ok) throw new Error("setup failed");

    const revisedAt = new Date("2026-10-28T09:00:00Z");
    const result = trx.revise({
      amount: newAmount.value,
      concept: "Weekly groceries",
      revisedAt,
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const revision = result.value;
    expect(revision.revisionNumber).toBe(1);
    expect(revision.kind).toBe("revision");
    expect(revision.changes).toEqual([
      { field: "amount", previous: "25.50", next: "30.00" },
      { field: "concept", previous: "Grocery run", next: "Weekly groceries" },
    ]);
    expect(trx.amount.toDecimalString()).toBe("30.00");
    expect(trx.concept).toBe("Weekly groceries");
    expect(trx.revisions).toHaveLength(1);
  });

  it("rejects a revision without changes", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");

    const result = created.value.revise({
      amount: amount.value,
      revisedAt: new Date(),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_NO_CHANGES");
    }
  });

  it("records a currency change as its own audited field", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const usd = Money.create("10", "USD");
    if (!usd.ok) throw new Error("setup failed");

    const result = created.value.revise({
      amount: usd.value,
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changes).toEqual([
      { field: "amount", previous: "25.50", next: "10.00" },
      { field: "currency", previous: "EUR", next: "USD" },
    ]);
    expect(created.value.amount.currency.code).toBe("USD");
  });

  it("assigns or changes accountId and records the field change (INV-CTA-03)", () => {
    const legacy = Transaction.reconstitute({
      ...baseInput,
      accountId: null,
      status: "confirmed",
      origin: "manual",
      originReference: null,
      revisions: [],
    });

    const first = legacy.revise({
      accountId: "acc-1",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.changes).toEqual([
      { field: "accountId", previous: "none", next: "acc-1" },
    ]);
    expect(legacy.accountId).toBe("acc-1");
  });

  it("revises an expense to transfer with destinationAccountId and clears category (INV-TFR-01, INV-TRX-03)", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.revise({
      type: "transfer",
      destinationAccountId: "acc-2",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(trx.type).toBe("transfer");
    expect(trx.destinationAccountId).toBe("acc-2");
    expect(trx.category).toEqual(UNCATEGORIZED);
    expect(result.value.changes).toEqual(
      expect.arrayContaining([
        { field: "type", previous: "expense", next: "transfer" },
        { field: "destinationAccountId", previous: "none", next: "acc-2" },
        { field: "category", previous: "categorized:cat-food", next: "uncategorized" },
      ]),
    );
  });

  it("rejects revising type to transfer without destinationAccountId (INV-TFR-01)", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");

    const result = created.value.revise({
      type: "transfer",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_DESTINATION_REQUIRED");
    }
  });

  it("rejects revising to transfer when destination equals source account (INV-TFR-02)", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");

    const result = created.value.revise({
      type: "transfer",
      destinationAccountId: "acc-1",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_SAME_ACCOUNT");
    }
  });

  it("rejects setting destinationAccountId on an income or expense revision", () => {
    const created = Transaction.recordManual({ ...baseInput, type: "income" });
    if (!created.ok) throw new Error("setup failed");

    const result = created.value.revise({
      destinationAccountId: "acc-2",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
    }
  });

  it("revises transfer fields and re-validates destination rules when revising from transfer", () => {
    const created = Transaction.recordManual({
      ...baseInput,
      type: "transfer",
      accountId: "acc-1",
      destinationAccountId: "acc-2",
    });
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const sameAccount = trx.revise({
      destinationAccountId: "acc-1",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(sameAccount.ok).toBe(false);
    if (!sameAccount.ok) {
      expect(sameAccount.error.code).toBe("TRANSFER_SAME_ACCOUNT");
    }

    const changeDest = trx.revise({
      destinationAccountId: "acc-3",
      revisedAt: new Date("2026-10-28T09:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(changeDest.ok).toBe(true);
    if (changeDest.ok) {
      expect(changeDest.value.changes).toEqual([
        { field: "destinationAccountId", previous: "acc-2", next: "acc-3" },
      ]);
    }

    const toExpenseWithoutClearing = trx.revise({
      type: "expense",
      revisedAt: new Date("2026-10-28T10:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(toExpenseWithoutClearing.ok).toBe(false);
    if (!toExpenseWithoutClearing.ok) {
      expect(toExpenseWithoutClearing.error.code).toBe("TRANSFER_DESTINATION_FORBIDDEN");
    }

    const toExpenseCleared = trx.revise({
      type: "expense",
      destinationAccountId: null,
      revisedAt: new Date("2026-10-28T10:00:00Z"),
      revisedBy: "subject-1",
    });
    expect(toExpenseCleared.ok).toBe(true);
    if (toExpenseCleared.ok) {
      expect(trx.type).toBe("expense");
      expect(trx.destinationAccountId).toBeNull();
      expect(toExpenseCleared.value.changes).toEqual([
        { field: "type", previous: "transfer", next: "expense" },
        { field: "destinationAccountId", previous: "acc-3", next: "none" },
      ]);
    }
  });
});

describe("Transaction.void", () => {
  it("voids a confirmed transaction keeping history", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;

    const result = trx.void({
      voidedAt: new Date("2026-10-28T09:00:00Z"),
      voidedBy: "subject-1",
    });

    expect(result.ok).toBe(true);
    expect(trx.status).toBe("voided");
    expect(trx.revisions).toHaveLength(1);
    expect(trx.revisions[0]?.kind).toBe("void");
  });

  it("rejects voiding twice", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;
    trx.void({ voidedAt: new Date(), voidedBy: "subject-1" });

    const result = trx.void({ voidedAt: new Date(), voidedBy: "subject-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_ALREADY_VOIDED");
    }
  });

  it("rejects revising a voided transaction", () => {
    const created = Transaction.recordManual(baseInput);
    if (!created.ok) throw new Error("setup failed");
    const trx = created.value;
    trx.void({ voidedAt: new Date(), voidedBy: "subject-1" });

    const result = trx.revise({
      concept: "late fix",
      revisedAt: new Date(),
      revisedBy: "subject-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSACTION_ALREADY_VOIDED");
    }
  });
});
