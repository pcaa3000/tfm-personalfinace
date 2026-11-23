import type { Clock } from "../../ledger/index.js";
import {
  ok,
  type DomainError,
  type Result,
} from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import type { AvoidableExpensesReportQueryPort } from "./ports/avoidable-expenses-report.port.js";
import {
  resolveReportPeriod,
  type ResolveReportPeriodInput,
} from "./resolve-report-period.js";
import {
  toAvoidableExpensesView,
  type AvoidableExpensesView,
} from "./avoidable-expenses.view.js";
import { shiftCalendarDays } from "../domain/report-period.js";

export type GetAvoidableExpensesCommand = ResolveReportPeriodInput;

const DAY_MS = 86_400_000;

/** Inclusive length in days of an inclusive [from, to] window. */
function windowDays(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        DAY_MS,
    ) + 1
  );
}

/**
 * Avoidable-expenses detection for a currency+period (reports-monthly
 * T12, S3+S11): the discretionary confirmed, non-voided expense
 * universe (INV-TRX-01, S8) grouped by normalized merchant — category
 * fallback — admitted when ANY detector fires (ant, recurring_charge,
 * concentration, growth). The growth detector needs the preceding
 * equal-length window, so the eligible lines are read twice: once for
 * the resolved window and once shifted back by the window length.
 */
export class GetAvoidableExpensesUseCase {
  constructor(
    private readonly closes: Pick<
      PeriodCloseRepositoryPort,
      "findActiveByPeriod"
    >,
    private readonly query: AvoidableExpensesReportQueryPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    command: GetAvoidableExpensesCommand,
  ): Promise<Result<AvoidableExpensesView, DomainError>> {
    const period = await resolveReportPeriod(
      this.closes,
      this.clock,
      command,
    );
    if (!period.ok) {
      return period;
    }

    // Preceding equal-length window for the growth detector: it ends
    // the day before the resolved window starts.
    const previousTo = shiftCalendarDays(period.value.from, -1);
    const previousFrom = shiftCalendarDays(
      previousTo,
      -(windowDays(period.value.from, period.value.to) - 1),
    );

    const [lines, previousLines, incomeMinor] = await Promise.all([
      this.query.discretionaryExpenseLines(
        command.workspaceId,
        period.value.currency,
        period.value.from,
        period.value.to,
      ),
      this.query.discretionaryExpenseLines(
        command.workspaceId,
        period.value.currency,
        previousFrom,
        previousTo,
      ),
      this.query.confirmedIncomeMinor(
        command.workspaceId,
        period.value.currency,
        period.value.from,
        period.value.to,
      ),
    ]);
    return ok(
      toAvoidableExpensesView(
        period.value,
        lines,
        previousLines,
        incomeMinor,
      ),
    );
  }
}
