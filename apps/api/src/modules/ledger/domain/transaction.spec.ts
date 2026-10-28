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

const workspaceId = WorkspaceId.create("ws-1");
if (!workspaceId.ok) throw new Error("setup failed");

const businessDate = BusinessDate.create("2026-10-27", "UTC");
if (!businessDate.ok) throw new Error("setup failed");

const amount = Money.create("25.50", "EUR");
if (!amount.ok) throw new Error("setup failed");

const baseInput = {
  id: "trx-1",
  workspaceId: workspaceId.value,
  type: "expense" as const,
  amount: amount.value,
  businessDate: businessDate.value,
  concept: "Grocery run",
  category: categorized("cat-food"),
  confirmedAt: new Date("2026-10-27T12:00:00Z"),
  confirmedBy: "subject-1",
};

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
