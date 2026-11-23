import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * One eligible expense line for the avoidable-expenses report
 * (reports-monthly T12, S3+S11): a confirmed, non-voided `expense` whose
 * head `categoryId` joins a category with `nature = 'discretionary'` —
 * rows with NULL categoryId are never eligible (uncategorized is not
 * discretionary). `merchant` is the normalized column added by S6; a
 * NULL merchant falls back to grouping by category.
 */
export interface AvoidableExpenseLine {
  readonly transactionId: string;
  readonly merchant: string | null;
  readonly categoryId: string;
  readonly categoryKey: string | null;
  readonly categoryLabel: string | null;
  readonly amountMinor: bigint;
}

/**
 * Read port for the avoidable-expenses report (docs/04 "Gastos hormiga"
 * evolved to "Gastos evitables", reports-monthly T12/S11): the eligible
 * discretionary expense lines plus the period's confirmed income, both
 * restricted to the same workspace, currency and inclusive [from, to]
 * window (INV-HOR-02 — never mixes currencies). The use case calls
 * `discretionaryExpenseLines` twice: once for the resolved window and
 * once for the preceding equal-length window feeding the growth
 * detector.
 */
export interface AvoidableExpensesReportQueryPort {
  discretionaryExpenseLines(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<AvoidableExpenseLine[]>;
  /** Total confirmed income in the window; 0n when there is none. */
  confirmedIncomeMinor(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<bigint>;
}

export const AVOIDABLE_EXPENSES_REPORT_QUERY = Symbol(
  "AVOIDABLE_EXPENSES_REPORT_QUERY",
);
