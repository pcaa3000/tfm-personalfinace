import { Money } from "../../shared-kernel/index.js";
import type { CurrencyTotals } from "./ports/balance-query.port.js";

/** Serializable per-currency balance read model for `GET /api/v1/balance`. */
export interface BalanceItemView {
  readonly currency: string;
  readonly initialBalance: string; // decimal string, never a float
  readonly income: string;
  readonly expenses: string;
  readonly net: string;
  readonly balance: string;
}

function toDecimal(minorUnits: bigint, currency: string): string {
  const money = Money.fromMinorUnits(minorUnits, currency);
  if (!money.ok) {
    throw money.error;
  }
  return money.value.toDecimalString();
}

/** Maps raw minor-unit totals to the public view (balance = initial + net). */
export function toBalanceItemView(row: CurrencyTotals): BalanceItemView {
  const netMinor = row.incomeMinor - row.expenseMinor;
  const balanceMinor = row.initialBalanceMinor + netMinor;
  return {
    currency: row.currency,
    initialBalance: toDecimal(row.initialBalanceMinor, row.currency),
    income: toDecimal(row.incomeMinor, row.currency),
    expenses: toDecimal(row.expenseMinor, row.currency),
    net: toDecimal(netMinor, row.currency),
    balance: toDecimal(balanceMinor, row.currency),
  };
}
