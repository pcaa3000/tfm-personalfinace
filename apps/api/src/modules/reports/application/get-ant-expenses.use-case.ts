import type { Clock } from "../../ledger/index.js";
import {
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import type { AntExpensesReportQueryPort } from "./ports/ant-expenses-report.port.js";
import {
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./resolve-report-period.js";
import {
  toAntExpensesView,
  type AntExpensesView,
} from "./ant-expenses.view.js";

export type GetAntExpensesCommand = ResolveReportPeriodInput;

/**
 * Ant-expenses detection for a currency+period (reports-monthly T5,
 * S3): confirmed, non-voided discretionary expenses (INV-TRX-01, S8)
 * grouped by normalized merchant — category fallback — filtered by the
 * docs/04 candidate policy (>=3 ops, mean <= 1% of income or absolute
 * cap, total >= 1% of discretionary spend). The period is the shared
 * resolution: closed month or provisional window.
 */
export class GetAntExpensesUseCase {
  constructor(
    private readonly closes: Pick<
      PeriodCloseRepositoryPort,
      "findActiveByPeriod"
    >,
    private readonly query: AntExpensesReportQueryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: GetAntExpensesCommand,
  ): Promise<Result<AntExpensesView, DomainError>> {
    const period = await resolveReportPeriod(
      this.closes,
      this.clock,
      command,
    );
    if (!period.ok) {
      return period;
    }

    const [lines, incomeMinor] = await Promise.all([
      this.query.discretionaryExpenseLines(
        command.workspaceId,
        period.value.currency,
        period.value.from,
        period.value.to,
      ),
      this.query.confirmedIncomeMinor(
        command.workspaceId,
        period.value.currency,
        period.value.from,
        period.value.to,
      ),
    ]);
    return ok(toAntExpensesView(period.value, lines, incomeMinor));
  }
}
