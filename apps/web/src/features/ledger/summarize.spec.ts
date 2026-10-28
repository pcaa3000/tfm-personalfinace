import { describe, expect, it } from "vitest";

import { summarizeByCurrency } from "./summarize";
import type { TransactionView } from "./types";

const trx = (partial: Partial<TransactionView>): TransactionView => ({
  id: "1",
  workspaceId: "ws",
  type: "expense",
  amount: "0.00",
  currency: "EUR",
  businessDate: "2026-10-27",
  timezone: "UTC",
  concept: "x",
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-27T00:00:00Z",
  revisionCount: 0,
  ...partial,
});

describe("summarizeByCurrency", () => {
  it("totals income and expenses per currency without mixing them", () => {
    const result = summarizeByCurrency([
      trx({ type: "income", amount: "100.00", currency: "EUR" }),
      trx({ type: "expense", amount: "25.50", currency: "EUR" }),
      trx({ type: "expense", amount: "10", currency: "USD" }),
      trx({ type: "income", amount: "1234", currency: "JPY" }),
    ]);

    expect(result).toEqual([
      { currency: "EUR", incomeMinor: 10000n, expenseMinor: 2550n, netMinor: 7450n },
      { currency: "JPY", incomeMinor: 1234n, expenseMinor: 0n, netMinor: 1234n },
      { currency: "USD", incomeMinor: 0n, expenseMinor: 1000n, netMinor: -1000n },
    ]);
  });

  it("ignores voided transactions", () => {
    const result = summarizeByCurrency([
      trx({ status: "voided", type: "expense", amount: "50", currency: "EUR" }),
    ]);

    expect(result).toEqual([]);
  });
});
