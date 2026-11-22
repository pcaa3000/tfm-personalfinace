import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * One eligible expense line for the ant-expenses report
 * (reports-monthly T5, S3): a confirmed, non-voided `expense` whose head
 * `categoryId` joins a category with `nature = 'discretionary'` — rows
 * with NULL categoryId are never eligible (uncategorized is not
 * discretionary). `merchant` is the normalized column added by S6; a
 * NULL merchant falls back to grouping by category.
 */
export interface AntExpenseLine {
  readonly transactionId: string;
  readonly merchant: string | null;
  readonly categoryId: string;
  readonly categoryKey: string | null;
  readonly categoryLabel: string | null;
  readonly amountMinor: bigint;
}

/**
 * Read port for the ant-expenses report (docs/04 "Gastos hormiga"):
 * the eligible discretionary expense lines plus the period's confirmed
 * income, both restricted to the same workspace, currency and inclusive
 * [from, to] window (INV-HOR-02 — never mixes currencies).
 */
export interface AntExpensesReportQueryPort {
  discretionaryExpenseLines(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<AntExpenseLine[]>;
  /** Total confirmed income in the window; 0n when there is none. */
  confirmedIncomeMinor(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<bigint>;
}

export const ANT_EXPENSES_REPORT_QUERY = Symbol("ANT_EXPENSES_REPORT_QUERY");
