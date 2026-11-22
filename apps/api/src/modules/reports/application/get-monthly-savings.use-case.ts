import type { Clock } from "../../ledger/index.js";
import {
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import type { MonthlySavingsReportQueryPort } from "./ports/monthly-savings-report.port.js";
import {
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./resolve-report-period.js";
import {
  toMonthlySavingsView,
  type MonthlySavingsView,
} from "./monthly-savings.view.js";

export type GetMonthlySavingsCommand = ResolveReportPeriodInput;

/**
 * Monthly savings for a currency+period (reports-monthly T6, S4):
 * observed savings rate and saved amount over confirmed, non-voided
 * income and expenses (INV-TRX-01, S8) — deficit and no-income months
 * stay representable without dividing by zero (CA-008). The period is
 * the shared resolution: closed month or provisional window.
 */
export class GetMonthlySavingsUseCase {
  constructor(
    private readonly closes: Pick<
      PeriodCloseRepositoryPort,
      "findActiveByPeriod"
    >,
    private readonly query: MonthlySavingsReportQueryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: GetMonthlySavingsCommand,
  ): Promise<Result<MonthlySavingsView, DomainError>> {
    const period = await resolveReportPeriod(
      this.closes,
      this.clock,
      command,
    );
    if (!period.ok) {
      return period;
    }

    const totals = await this.query.incomeExpenseTotals(
      command.workspaceId,
      period.value.currency,
      period.value.from,
      period.value.to,
    );
    return ok(
      toMonthlySavingsView(
        period.value,
        totals.incomeMinor,
        totals.expenseMinor,
      ),
    );
  }
}
