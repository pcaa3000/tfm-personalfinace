import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Raw per-category expense totals for a resolved period
 * (reports-monthly T4, S2). `categoryId === null` marks rows without a
 * category; `nature` mirrors `categorization_categories.nature`, which
 * may hold the system "uncategorized" marker outside CategoryNature.
 */
export interface ExpenseCategoryTotals {
  readonly categoryId: string | null;
  readonly categoryKey: string | null;
  readonly categoryLabel: string | null;
  readonly nature: string | null;
  readonly totalMinor: bigint;
  /** Distinct transactions contributing to the group. */
  readonly transactionCount: number;
}

/**
 * Read port for the expenses-by-category report: confirmed, non-voided
 * expense rows in `currency` inside the inclusive [from, to] window.
 * Transactions WITH splits are attributed split-by-split
 * (INV-TRX-SPLIT-01); transactions without splits contribute their head
 * `categoryId` (null → the uncategorized bucket).
 */
export interface ExpensesByCategoryReportQueryPort {
  totalsPerCategory(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<ExpenseCategoryTotals[]>;
}

export const EXPENSES_BY_CATEGORY_REPORT_QUERY = Symbol(
  "EXPENSES_BY_CATEGORY_REPORT_QUERY",
);
