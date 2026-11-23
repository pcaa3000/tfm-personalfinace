// Public API of the reports module (monthly reports + period closes).
// Other modules consume use cases and read models exposed here; internal
// layers (domain/, application/, infrastructure/) are not importable.
export {
  PeriodClose,
  calendarMonthPeriod,
  isCalendarMonthFinished,
  localCalendarDateInTimezone,
  type PeriodCloseState,
  type MonthPeriod,
} from "./domain/period-close.js";
export {
  shiftCalendarDays,
  type ReportPeriod,
  type ReportPeriodStatus,
} from "./domain/report-period.js";
export {
  PERIOD_CLOSE_REPOSITORY,
  type PeriodCloseRepositoryPort,
} from "./application/ports/period-close-repository.port.js";
export {
  CASH_FLOW_REPORT_QUERY,
  type CashFlowAccountTotals,
  type CashFlowReportQueryPort,
} from "./application/ports/cash-flow-report.port.js";
export {
  EXPENSES_BY_CATEGORY_REPORT_QUERY,
  type ExpenseCategoryTotals,
  type ExpensesByCategoryReportQueryPort,
} from "./application/ports/expenses-by-category-report.port.js";
export {
  AVOIDABLE_EXPENSES_REPORT_QUERY,
  type AvoidableExpenseLine,
  type AvoidableExpensesReportQueryPort,
} from "./application/ports/avoidable-expenses-report.port.js";
export {
  MONTHLY_SAVINGS_REPORT_QUERY,
  type MonthlySavingsReportQueryPort,
  type MonthlySavingsTotals,
} from "./application/ports/monthly-savings-report.port.js";
export {
  ClosePeriodUseCase,
  type ClosePeriodCommand,
} from "./application/close-period.use-case.js";
export { ListPeriodClosesUseCase } from "./application/list-period-closes.use-case.js";
export {
  PROVISIONAL_WINDOW_DAYS,
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./application/resolve-report-period.js";
export {
  GetCashFlowReportUseCase,
  type GetCashFlowReportCommand,
} from "./application/get-cash-flow-report.use-case.js";
export {
  GetExpensesByCategoryUseCase,
  type GetExpensesByCategoryCommand,
} from "./application/get-expenses-by-category.use-case.js";
export {
  GetAvoidableExpensesUseCase,
  type GetAvoidableExpensesCommand,
} from "./application/get-avoidable-expenses.use-case.js";
export {
  GetMonthlySavingsUseCase,
  type GetMonthlySavingsCommand,
} from "./application/get-monthly-savings.use-case.js";
export {
  toPeriodCloseView,
  type PeriodCloseView,
} from "./application/period-close.view.js";
export {
  toCashFlowReportView,
  type CashFlowAccountView,
  type CashFlowReportView,
} from "./application/cash-flow.view.js";
export {
  toExpensesByCategoryView,
  type ExpenseCategoryView,
  type ExpensesByCategoryView,
} from "./application/expenses-by-category.view.js";
export {
  ANT_DETECTOR_ABSOLUTE_CAP_MINOR,
  ANT_DETECTOR_MIN_OPERATIONS,
  CONCENTRATION_MIN_PERCENT,
  GROWTH_MIN_RATIO_PERCENT,
  MIN_SHARE_OF_DISCRETIONARY_PERCENT,
  RECURRING_CHARGE_MAX_RATIO_PERCENT,
  RECURRING_CHARGE_MIN_OPERATIONS,
  toAvoidableExpensesView,
  type AvoidableExpenseDetector,
  type AvoidableExpenseGroupView,
  type AvoidableExpensesView,
} from "./application/avoidable-expenses.view.js";
export {
  toMonthlySavingsView,
  type MonthlySavingsView,
} from "./application/monthly-savings.view.js";
export {
  XLSX_REPORT_SERIALIZER,
  type XlsxReportSerializerPort,
} from "./application/ports/xlsx-report-export.port.js";
export {
  reportExportTables,
  serializeReportCsv,
  type MonthlyReportBundle,
  type ReportExportMetadata,
  type ReportExportTable,
} from "./application/report-export.serializer.js";
export {
  ExportMonthlyReportUseCase,
  type ExportMonthlyReportCommand,
  type ReportExportFile,
  type ReportExportFormat,
} from "./application/export-monthly-report.use-case.js";
