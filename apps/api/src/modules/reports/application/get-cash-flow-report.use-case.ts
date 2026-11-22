import type { Clock } from "../../ledger/index.js";
import {
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import type { CashFlowReportQueryPort } from "./ports/cash-flow-report.port.js";
import {
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./resolve-report-period.js";
import {
  toCashFlowReportView,
  type CashFlowReportView,
} from "./cash-flow.view.js";

export type GetCashFlowReportCommand = ResolveReportPeriodInput;

/**
 * Cash flow per account for a currency+period (reports-monthly T3, S1):
 * income, expense, transfers in/out and net flow, restricted to
 * confirmed, non-voided transactions (INV-TRX-01, S8). The period is the
 * shared resolution: running month → provisional 30-day window, finished
 * month → closed or provisional full month.
 */
export class GetCashFlowReportUseCase {
  constructor(
    private readonly closes: Pick<
      PeriodCloseRepositoryPort,
      "findActiveByPeriod"
    >,
    private readonly query: CashFlowReportQueryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: GetCashFlowReportCommand,
  ): Promise<Result<CashFlowReportView, DomainError>> {
    const period = await resolveReportPeriod(
      this.closes,
      this.clock,
      command,
    );
    if (!period.ok) {
      return period;
    }

    const rows = await this.query.totalsPerAccount(
      command.workspaceId,
      period.value.currency,
      period.value.from,
      period.value.to,
    );
    return ok(toCashFlowReportView(period.value, rows));
  }
}
