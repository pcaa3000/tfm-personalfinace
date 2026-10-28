import type { TransactionView } from "./types";

export interface CurrencySummary {
  currency: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
}

/**
 * Per-currency totals of confirmed transactions. Currencies are never
 * summed together (RN-005): each summary row is a separate currency.
 */
export function summarizeByCurrency(transactions: TransactionView[]): CurrencySummary[] {
  const scale = (currency: string): number =>
    ({ JPY: 0, KRW: 0, BHD: 3, KWD: 3, CLF: 4 })[currency] ?? 2;

  const toMinor = (amount: string, currency: string): bigint => {
    const [intPart = "0", fracPart = ""] = amount.split(".");
    const exponent = scale(currency);
    const digits = intPart + fracPart.padEnd(exponent, "0");
    return BigInt(digits);
  };

  const totals = new Map<string, { income: bigint; expense: bigint }>();
  for (const trx of transactions) {
    if (trx.status !== "confirmed") continue;
    const entry = totals.get(trx.currency) ?? { income: 0n, expense: 0n };
    if (trx.type === "income") {
      entry.income += toMinor(trx.amount, trx.currency);
    } else {
      entry.expense += toMinor(trx.amount, trx.currency);
    }
    totals.set(trx.currency, entry);
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({
      currency,
      incomeMinor: t.income,
      expenseMinor: t.expense,
      netMinor: t.income - t.expense,
    }));
}
