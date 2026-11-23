import { request, requestBlob } from "../ledger/api";

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

// --- GET /reports/avoidable-expenses (S3+S11, T12) --------------------

/** Detector keys the API reports on each admitted group (S11). */
export type AvoidableExpenseDetector =
  | "ant"
  | "recurring_charge"
  | "concentration"
  | "growth";

export interface AvoidableExpenseGroupView {
  readonly detectors: AvoidableExpenseDetector[];
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

export interface AvoidableExpensesView {
  readonly period: ReportPeriod;
  readonly totalDiscretionary: string;
  /** Sum of every admitted group's total — the monthly avoidable spend. */
  readonly potentialSavings: string;
  readonly groups: AvoidableExpenseGroupView[];
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

/** `GET /api/v1/reports/avoidable-expenses?currency&year&month` (S3+S11). */
export function fetchAvoidableExpenses(
  query: ReportPeriodQuery,
): Promise<AvoidableExpensesView> {
  return request<AvoidableExpensesView>(
    `/reports/avoidable-expenses${periodQuery(query)}`,
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

// --- /period-closes (S5, T9) ------------------------------------------

/** Mirrors the API's `PeriodCloseView` (`stale` = invalidated, never
 * rewritten; a stale close may be re-closed and gets superseded). */
export interface PeriodCloseView {
  readonly id: string;
  readonly currency: string;
  readonly periodStart: string; // YYYY-MM-DD
  readonly periodEnd: string; // YYYY-MM-DD
  readonly timezone: string;
  readonly integrityDeclared: boolean;
  readonly closedAt: string;
  readonly invalidatedAt: string | null;
  readonly supersededAt: string | null;
  readonly stale: boolean;
}

/** `GET /api/v1/period-closes?currency=` — active closes, newest first. */
export function listPeriodCloses(
  currency?: string,
): Promise<PeriodCloseView[]> {
  const query = currency
    ? `?${new URLSearchParams({ currency }).toString()}`
    : "";
  return request<PeriodCloseView[]>(`/period-closes${query}`);
}

/**
 * `POST /api/v1/period-closes` — the user-declared monthly close (S5).
 * `integrityConfirmed` is a literal `true`: the dialog collects the
 * declaration, the client always posts it. The API answers 201, or 409
 * `PERIOD_ALREADY_CLOSED` when a fresh (non-stale) close already exists.
 */
export function closePeriod(
  currency: string,
  year: number,
  month: number,
): Promise<PeriodCloseView> {
  return request<PeriodCloseView>("/period-closes", {
    method: "POST",
    body: JSON.stringify({ currency, year, month, integrityConfirmed: true }),
  });
}

// --- GET /reports/export (T10) ----------------------------------------

export type ReportExportFormat = "csv" | "xlsx";

/**
 * `GET /api/v1/reports/export?currency&year&month&format` — the monthly
 * report bundle as a downloadable attachment (binary, not JSON).
 */
export function fetchReportExport(
  query: ReportPeriodQuery,
  format: ReportExportFormat,
): Promise<Blob> {
  const params = new URLSearchParams({
    currency: query.currency,
    year: String(query.year),
    month: String(query.month),
    format,
  });
  return requestBlob(`/reports/export?${params.toString()}`);
}
