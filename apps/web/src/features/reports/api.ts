import { request } from "../ledger/api";

/**
 * Client for the `GET /api/v1/reports/*` surface (reports-monthly
 * T3–T6 → T7 page). The view types mirror the API response shapes
 * one-to-one — amounts are decimal strings (INV-DIN-03), never
 * floats, and every report shares the same `?currency&year&month`
 * query contract plus a `period` describing the resolved window.
 */
export type ReportPeriodStatus = "provisional" | "closed";

export interface ReportPeriod {
  readonly from: string; // YYYY-MM-DD, inclusive
  readonly to: string; // YYYY-MM-DD, inclusive
  readonly currency: string;
  readonly periodStatus: ReportPeriodStatus;
}

/** Query shared by every monthly report endpoint. */
export interface ReportPeriodQuery {
  readonly currency: string;
  readonly year: number;
  readonly month: number; // 1–12
}

// --- GET /reports/cash-flow (S1) -------------------------------------

export interface CashFlowAccountView {
  readonly accountId: string | null;
  readonly name: string | null;
  readonly kind: string | null;
  readonly income: string;
  readonly expense: string;
  readonly transfersIn: string;
  readonly transfersOut: string;
  readonly netFlow: string;
}

export interface CashFlowReportView {
  readonly period: ReportPeriod;
  readonly accounts: CashFlowAccountView[];
}

// --- GET /reports/expenses-by-category (S2) --------------------------

export interface ExpenseCategoryView {
  readonly categoryId: string | null;
  readonly key: string;
  readonly label: string;
  readonly nature: string;
  readonly total: string;
  readonly percentOfExpenses: number;
  readonly transactionCount: number;
}

export interface ExpensesByCategoryView {
  readonly period: ReportPeriod;
  readonly totalExpenses: string;
  readonly natureTotals: Record<string, string>;
  readonly categories: ExpenseCategoryView[];
}

// --- GET /reports/ant-expenses (S3) ----------------------------------

export interface AntExpenseGroupView {
  readonly groupKind: "merchant" | "category";
  readonly key: string;
  readonly label: string;
  readonly operationCount: number;
  readonly total: string;
  readonly average: string;
  readonly percentOfDiscretionary: number;
  readonly confidence: "low" | "high";
  readonly transactionIds: string[];
}

export interface AntExpensesView {
  readonly period: ReportPeriod;
  readonly totalDiscretionary: string;
  readonly groups: AntExpenseGroupView[];
}

// --- GET /reports/monthly-savings (S4) -------------------------------

export interface MonthlySavingsView {
  readonly period: ReportPeriod;
  readonly income: string;
  readonly expense: string;
  readonly saved: string;
  /** Percentage string "NN.NN"; null when there is no income. */
  readonly observedRate: string | null;
  readonly note: "no_income" | "deficit" | null;
  readonly deficit: string | null;
}

function periodQuery({ currency, year, month }: ReportPeriodQuery): string {
  const params = new URLSearchParams({
    currency,
    year: String(year),
    month: String(month),
  });
  return `?${params.toString()}`;
}

/** `GET /api/v1/reports/cash-flow?currency&year&month` (S1). */
export function fetchCashFlowReport(
  query: ReportPeriodQuery,
): Promise<CashFlowReportView> {
  return request<CashFlowReportView>(
    `/reports/cash-flow${periodQuery(query)}`,
  );
}

/** `GET /api/v1/reports/expenses-by-category?currency&year&month` (S2). */
export function fetchExpensesByCategory(
  query: ReportPeriodQuery,
): Promise<ExpensesByCategoryView> {
  return request<ExpensesByCategoryView>(
    `/reports/expenses-by-category${periodQuery(query)}`,
  );
}

/** `GET /api/v1/reports/ant-expenses?currency&year&month` (S3). */
export function fetchAntExpenses(
  query: ReportPeriodQuery,
): Promise<AntExpensesView> {
  return request<AntExpensesView>(
    `/reports/ant-expenses${periodQuery(query)}`,
  );
}

/** `GET /api/v1/reports/monthly-savings?currency&year&month` (S4). */
export function fetchMonthlySavings(
  query: ReportPeriodQuery,
): Promise<MonthlySavingsView> {
  return request<MonthlySavingsView>(
    `/reports/monthly-savings${periodQuery(query)}`,
  );
}
