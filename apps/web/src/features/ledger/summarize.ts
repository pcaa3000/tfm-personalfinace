import type { AccountView, TransactionView } from "./types";

export interface CurrencySummary {
  currency: string;
  incomeMinor: bigint;
  expenseMinor: bigint;
  netMinor: bigint;
  initialBalanceMinor: bigint;
  /** Saldo actual = Σ saldos iniciales + ingresos − gastos (S12-5). */
  balanceMinor: bigint;
}

/** Fallback minor-unit exponent for the few non-2 ISO currencies shown
 *  before the workspace currency catalog resolves. */
export function defaultCurrencyExponent(currency: string): number {
  return ({ JPY: 0, KRW: 0, BHD: 3, KWD: 3, CLF: 4 })[currency] ?? 2;
}

/**
 * Per-currency totals of confirmed transactions plus the initial balances
 * of the workspace accounts. Currencies are never summed together
 * (RN-005): each summary row is a separate currency. Transfers count
 * net 0 — they are neither income nor expense (S12-3).
 */
export function summarizeByCurrency(
  transactions: TransactionView[],
  accounts: AccountView[] = [],
  exponentOf: (code: string) => number = defaultCurrencyExponent,
): CurrencySummary[] {
  const toMinor = (amount: string, currency: string): bigint => {
    const [intPart = "0", fracPart = ""] = amount.split(".");
    const exponent = exponentOf(currency);
    const negative = intPart.startsWith("-");
    const digits =
      intPart.replace("-", "") + fracPart.padEnd(exponent, "0").slice(0, exponent);
    const minor = BigInt(digits || "0");
    return negative ? -minor : minor;
  };

  const totals = new Map<
    string,
    { income: bigint; expense: bigint; initial: bigint }
  >();
  const bucket = (currency: string) =>
    totals.get(currency) ?? { income: 0n, expense: 0n, initial: 0n };

  for (const account of accounts) {
    if (account.archivedAt !== null) continue;
    const entry = bucket(account.currency);
    entry.initial += toMinor(account.initialBalance, account.currency);
    totals.set(account.currency, entry);
  }

  for (const trx of transactions) {
    if (trx.status !== "confirmed") continue;
    if (trx.type === "transfer") continue; // net 0 in the currency balance
    const entry = bucket(trx.currency);
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
      initialBalanceMinor: t.initial,
      balanceMinor: t.initial + t.income - t.expense,
    }));
}
