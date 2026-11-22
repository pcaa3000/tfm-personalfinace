import type { Clock } from "../../ledger/index.js";
import {
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import type { ExpensesByCategoryReportQueryPort } from "./ports/expenses-by-category-report.port.js";
import {
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./resolve-report-period.js";
import {
  toExpensesByCategoryView,
  type ExpensesByCategoryView,
} from "./expenses-by-category.view.js";

export type GetExpensesByCategoryCommand = ResolveReportPeriodInput;

/**
 * Expenses by category for a currency+period (reports-monthly T4, S2):
 * split-aware attribution (INV-TRX-SPLIT-01), per-group total/percent/
 * transaction count and nature subtotals, restricted to confirmed,
 * non-voided transactions (INV-TRX-01, S8).
 */
export class GetExpensesByCategoryUseCase {
  constructor(
    private readonly closes: Pick<
      PeriodCloseRepositoryPort,
      "findActiveByPeriod"
    >,
    private readonly query: ExpensesByCategoryReportQueryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: GetExpensesByCategoryCommand,
  ): Promise<Result<ExpensesByCategoryView, DomainError>> {
    const period = await resolveReportPeriod(
      this.closes,
      this.clock,
      command,
    );
    if (!period.ok) {
      return period;
    }

    const rows = await this.query.totalsPerCategory(
      command.workspaceId,
      period.value.currency,
      period.value.from,
      period.value.to,
    );
    return ok(toExpensesByCategoryView(period.value, rows));
  }
}
