import { Money } from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";

/**
 * Monthly savings for `GET /api/v1/reports/monthly-savings`
 * (reports-monthly T6, S4, CA-008): `saved` = income − expense,
 * `observedRate` = saved/income as a percentage string with two
 * decimals. Without positive income the rate is omitted (`null`,
 * `note: "no_income"` — never divides by zero); when expenses reach or
 * exceed income the rate floors at "0.00" with `note: "deficit"` and
 * the explicit `deficit` amount (expense − income).
 */
export interface MonthlySavingsView {
  readonly period: ReportPeriod;
  readonly income: string; // decimal string, never a float (INV-DIN-03)
  readonly expense: string;
  readonly saved: string;
  readonly observedRate: string | null;
  readonly note: "no_income" | "deficit" | null;
  readonly deficit: string | null;
}

function toDecimal(minorUnits: bigint, currency: string): string {
  const money = Money.fromMinorUnits(minorUnits, currency);
  if (!money.ok) {
    throw money.error;
  }
  return money.value.toDecimalString();
}

/** `part/whole` as a "NNN.NN" percentage string rounded half-up. */
function percentString(part: bigint, whole: bigint): string {
  const hundredths = (part * 10000n + whole / 2n) / whole;
  const integerPart = hundredths / 100n;
  const fractionPart = (hundredths % 100n).toString().padStart(2, "0");
  return `${integerPart}.${fractionPart}`;
}

export function toMonthlySavingsView(
  period: ReportPeriod,
  incomeMinor: bigint,
  expenseMinor: bigint,
): MonthlySavingsView {
  const savedMinor = incomeMinor - expenseMinor;
  const base = {
    period,
    income: toDecimal(incomeMinor, period.currency),
    expense: toDecimal(expenseMinor, period.currency),
    saved: toDecimal(savedMinor, period.currency),
  };

  if (incomeMinor <= 0n) {
    return { ...base, observedRate: null, note: "no_income", deficit: null };
  }
  if (expenseMinor >= incomeMinor) {
    return {
      ...base,
      observedRate: "0.00",
      note: "deficit",
      deficit: toDecimal(expenseMinor - incomeMinor, period.currency),
    };
  }
  return {
    ...base,
    observedRate: percentString(savedMinor, incomeMinor),
    note: null,
    deficit: null,
  };
}
