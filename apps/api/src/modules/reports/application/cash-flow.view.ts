import { Money } from "../../shared-kernel/index.js";
import type { ReportPeriod } from "../domain/report-period.js";
import type { CashFlowAccountTotals } from "./ports/cash-flow-report.port.js";

/**
 * Per-account cash flow for `GET /api/v1/reports/cash-flow`
 * (reports-monthly T3, S1). `accountId === null` is the explicit
 * "unassigned" group for transactions without an account.
 */
export interface CashFlowAccountView {
  readonly accountId: string | null;
  readonly name: string | null;
  readonly kind: string | null;
  readonly income: string; // decimal string, never a float (INV-DIN-03)
  readonly expense: string;
  readonly transfersIn: string;
  readonly transfersOut: string;
  readonly netFlow: string;
}

export interface CashFlowReportView {
  readonly period: ReportPeriod;
  readonly accounts: CashFlowAccountView[];
}

function toDecimal(minorUnits: bigint, currency: string): string {
  const money = Money.fromMinorUnits(minorUnits, currency);
  if (!money.ok) {
    throw money.error;
  }
  return money.value.toDecimalString();
}

/**
 * Maps raw minor-unit totals to the public view. netFlow =
 * income − expense + transfersIn − transfersOut. Named accounts sort
 * alphabetically; the unassigned group always comes last.
 */
export function toCashFlowReportView(
  period: ReportPeriod,
  rows: readonly CashFlowAccountTotals[],
): CashFlowReportView {
  const sorted = [...rows].sort((a, b) => {
    if (a.accountId === null) return 1;
    if (b.accountId === null) return -1;
    const byName = (a.accountName ?? "").localeCompare(b.accountName ?? "");
    return byName !== 0 ? byName : a.accountId.localeCompare(b.accountId);
  });
  return {
    period,
    accounts: sorted.map((row) => {
      const netFlowMinor =
        row.incomeMinor -
        row.expenseMinor +
        row.transfersInMinor -
        row.transfersOutMinor;
      return {
        accountId: row.accountId,
        name: row.accountName,
        kind: row.accountKind,
        income: toDecimal(row.incomeMinor, period.currency),
        expense: toDecimal(row.expenseMinor, period.currency),
        transfersIn: toDecimal(row.transfersInMinor, period.currency),
        transfersOut: toDecimal(row.transfersOutMinor, period.currency),
        netFlow: toDecimal(netFlowMinor, period.currency),
      };
    }),
  };
}
