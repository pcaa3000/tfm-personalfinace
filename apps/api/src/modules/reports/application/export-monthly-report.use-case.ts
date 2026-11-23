import type { Clock } from "../../ledger/index.js";
import {
  err,
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { GetAntExpensesUseCase } from "./get-ant-expenses.use-case.js";
import type { GetCashFlowReportUseCase } from "./get-cash-flow-report.use-case.js";
import type { GetExpensesByCategoryUseCase } from "./get-expenses-by-category.use-case.js";
import type { GetMonthlySavingsUseCase } from "./get-monthly-savings.use-case.js";
import type { ResolveReportPeriodInput } from "./resolve-report-period.js";
import type { XlsxReportSerializerPort } from "./ports/xlsx-report-export.port.js";
import {
  serializeReportCsv,
  type MonthlyReportBundle,
} from "./report-export.serializer.js";

export type ReportExportFormat = "csv" | "xlsx";

export interface ExportMonthlyReportCommand
  extends ResolveReportPeriodInput {
  readonly format: ReportExportFormat;
}

/** The downloadable file the route streams back to the client. */
export interface ReportExportFile {
  readonly filename: string;
  readonly contentType: string;
  /** CSV is UTF-8 text; XLSX is binary. */
  readonly body: string | Uint8Array<ArrayBuffer>;
}

const CONTENT_TYPE: Record<ReportExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Monthly report export (reports-monthly T10, S9, CA-022/CA-014):
 * reuses the four report use cases over the shared period resolution,
 * prepends the metadata block (workspace timezone, currency, period
 * bounds/status, generatedAt) and serializes the bundle as CSV or
 * XLSX — `report-<CURRENCY>-<YYYY>-<MM>.<ext>`.
 */
export class ExportMonthlyReportUseCase {
  constructor(
    private readonly cashFlow: Pick<GetCashFlowReportUseCase, "execute">,
    private readonly expensesByCategory: Pick<
      GetExpensesByCategoryUseCase,
      "execute"
    >,
    private readonly antExpenses: Pick<GetAntExpensesUseCase, "execute">,
    private readonly monthlySavings: Pick<
      GetMonthlySavingsUseCase,
      "execute"
    >,
    private readonly xlsx: XlsxReportSerializerPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: ExportMonthlyReportCommand,
  ): Promise<Result<ReportExportFile, DomainError>> {
    const input: ResolveReportPeriodInput = {
      workspaceId: command.workspaceId,
      currency: command.currency,
      year: command.year,
      month: command.month,
      timezone: command.timezone,
    };
    const [cashFlow, byCategory, ant, savings] = await Promise.all([
      this.cashFlow.execute(input),
      this.expensesByCategory.execute(input),
      this.antExpenses.execute(input),
      this.monthlySavings.execute(input),
    ]);
    // First failure wins, in fixed section order.
    if (!cashFlow.ok) return err(cashFlow.error);
    if (!byCategory.ok) return err(byCategory.error);
    if (!ant.ok) return err(ant.error);
    if (!savings.ok) return err(savings.error);

    const bundle: MonthlyReportBundle = {
      metadata: {
        timezone: command.timezone,
        currency: cashFlow.value.period.currency,
        from: cashFlow.value.period.from,
        to: cashFlow.value.period.to,
        periodStatus: cashFlow.value.period.periodStatus,
        generatedAt: this.clock.now().toISOString(),
      },
      cashFlow: cashFlow.value,
      expensesByCategory: byCategory.value,
      antExpenses: ant.value,
      monthlySavings: savings.value,
    };

    const filename =
      `report-${input.currency.toUpperCase()}-` +
      `${String(input.year).padStart(4, "0")}-` +
      `${String(input.month).padStart(2, "0")}.${command.format}`;
    const body =
      command.format === "csv"
        ? serializeReportCsv(bundle)
        : await this.xlsx.serialize(bundle);
    return ok({
      filename,
      contentType: CONTENT_TYPE[command.format],
      body,
    });
  }
}
