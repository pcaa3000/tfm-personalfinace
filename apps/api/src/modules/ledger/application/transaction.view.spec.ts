import { describe, expect, it } from "vitest";

import {
  BusinessDate,
  Money,
  WorkspaceId,
} from "../../shared-kernel/index.js";
import { Transaction, categorized } from "../domain/transaction.js";
import { toTransactionView } from "./transaction.view.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeTransaction(
  overrides: {
    origin?: "manual" | "ticket" | "voice";
    originReference?: string;
  } = {},
): Transaction {
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
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
    ...(overrides.originReference === undefined
      ? {}
      : { originReference: overrides.originReference }),
    confirmedAt: new Date("2026-10-27T10:00:00Z"),
    confirmedBy: "subject-1",
  });
  if (!trx.ok) throw new Error("setup failed");
  return trx.value;
}

describe("toTransactionView (receipt-review-link T2, S2)", () => {
  it("serializes the ticket scan id as originReference next to origin", () => {
    const view = toTransactionView(
      makeTransaction({ origin: "ticket", originReference: "scan-1" }),
    );

    expect(view.origin).toBe("ticket");
    expect(view.originReference).toBe("scan-1");
  });

  it("serializes a null originReference for manual transactions", () => {
    const view = toTransactionView(makeTransaction());

    expect(view.origin).toBe("manual");
    expect(view.originReference).toBeNull();
  });
});

describe("toTransactionView — merchant (reports-monthly T1, S6)", () => {
  it("exposes the normalized merchant derived from the concept", () => {
    const view = toTransactionView(makeTransaction());

    expect(view.merchant).toBe("grocery run");
  });
});
