import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Raw income/expense totals for the monthly-savings report
 * (reports-monthly T6, S4): confirmed, non-voided `income` and
 * `expense` rows in `currency` inside the inclusive [from, to] window.
 * Expenses count every nature — essential, discretionary, obligation
 * and uncategorized; transfers never participate.
 */
export interface MonthlySavingsTotals {
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
}

/** Read port for the monthly-savings report. */
export interface MonthlySavingsReportQueryPort {
  incomeExpenseTotals(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<MonthlySavingsTotals>;
}

export const MONTHLY_SAVINGS_REPORT_QUERY = Symbol(
  "MONTHLY_SAVINGS_REPORT_QUERY",
);
