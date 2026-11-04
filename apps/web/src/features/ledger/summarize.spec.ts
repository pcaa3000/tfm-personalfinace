import { describe, expect, it } from "vitest";

import { summarizeByCurrency } from "./summarize";
import type { AccountView, TransactionView } from "./types";

const trx = (partial: Partial<TransactionView>): TransactionView => ({
  id: "1",
  workspaceId: "ws",
  type: "expense",
  amount: "0.00",
  currency: "EUR",
  businessDate: "2026-10-27",
  accountId: "acc-1",
  destinationAccountId: null,
  timezone: "UTC",
  concept: "x",
  categoryId: null,
  status: "confirmed",
  origin: "manual",
  confirmedAt: "2026-10-27T00:00:00Z",
  revisionCount: 0,
  ...partial,
});

const account = (partial: Partial<AccountView>): AccountView => ({
  id: "acc-1",
  workspaceId: "ws",
  name: "Cuenta",
  currency: "EUR",
  kind: "bank",
  initialBalance: "0.00",
  archivedAt: null,
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
      {
        currency: "EUR",
        incomeMinor: 10000n,
        expenseMinor: 2550n,
        netMinor: 7450n,
        initialBalanceMinor: 0n,
        balanceMinor: 7450n,
      },
      {
        currency: "JPY",
        incomeMinor: 1234n,
        expenseMinor: 0n,
        netMinor: 1234n,
        initialBalanceMinor: 0n,
        balanceMinor: 1234n,
      },
      {
        currency: "USD",
        incomeMinor: 0n,
        expenseMinor: 1000n,
        netMinor: -1000n,
        initialBalanceMinor: 0n,
        balanceMinor: -1000n,
      },
    ]);
  });

  it("ignores voided transactions", () => {
    const result = summarizeByCurrency([
      trx({ status: "voided", type: "expense", amount: "50", currency: "EUR" }),
    ]);

    expect(result).toEqual([]);
  });

  it("counts transfers as net zero — never income nor expense (S12-3)", () => {
    const result = summarizeByCurrency(
      [
        trx({ type: "income", amount: "100.00" }),
        trx({ type: "transfer", amount: "40.00" }),
        trx({ type: "expense", amount: "10.00" }),
      ],
      [account({ initialBalance: "0.00" })],
    );

    expect(result).toEqual([
      {
        currency: "EUR",
        incomeMinor: 10000n,
        expenseMinor: 1000n,
        netMinor: 9000n,
        initialBalanceMinor: 0n,
        balanceMinor: 9000n,
      },
    ]);
  });

  it("computes saldo actual = initial balances + income − expenses (S12-5)", () => {
    const result = summarizeByCurrency(
      [
        trx({ type: "income", amount: "100.00", currency: "EUR" }),
        trx({ type: "expense", amount: "25.50", currency: "EUR" }),
        trx({ type: "transfer", amount: "999.99", currency: "EUR" }),
      ],
      [
        account({ id: "a1", currency: "EUR", initialBalance: "1000.00" }),
        account({ id: "a2", currency: "EUR", initialBalance: "250.50" }),
        account({ id: "a3", currency: "USD", initialBalance: "20.50" }),
      ],
    );

    expect(result).toEqual([
      {
        currency: "EUR",
        incomeMinor: 10000n,
        expenseMinor: 2550n,
        netMinor: 7450n,
        initialBalanceMinor: 125050n,
        balanceMinor: 132500n,
      },
      {
        currency: "USD",
        incomeMinor: 0n,
        expenseMinor: 0n,
        netMinor: 0n,
        initialBalanceMinor: 2050n,
        balanceMinor: 2050n,
      },
    ]);
  });

  it("uses the provided exponent resolver for initial balances", () => {
    const result = summarizeByCurrency(
      [],
      [account({ currency: "JPY", initialBalance: "1500" })],
      (code) => (code === "JPY" ? 0 : 2),
    );

    expect(result[0]?.initialBalanceMinor).toBe(1500n);
    expect(result[0]?.balanceMinor).toBe(1500n);
  });
});
