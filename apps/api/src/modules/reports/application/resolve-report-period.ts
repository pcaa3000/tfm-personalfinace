import type { Clock } from "../../ledger/index.js";
import {
  CurrencyCode,
  DomainError,
  WorkspaceId,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import {
  calendarMonthPeriod,
  isCalendarMonthFinished,
  localCalendarDateInTimezone,
} from "../domain/period-close.js";
import { shiftCalendarDays, type ReportPeriod } from "../domain/report-period.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";

export interface ResolveReportPeriodInput {
  readonly workspaceId: WorkspaceId;
  readonly currency: string;
  readonly year: number;
  readonly month: number;
  /** Workspace timezone resolved server-side; never client input. */
  readonly timezone: string;
}

/**
 * Inclusive length of the provisional window for the running month
 * (reports-monthly S5): the last 30 calendar days ending on the local
 * today of the workspace timezone.
 */
export const PROVISIONAL_WINDOW_DAYS = 30;

/**
 * Shared period resolution for every monthly report (T3–T6):
 * - running month in the workspace timezone → `provisional`, window =
 *   last 30 days ending on the local today;
 * - finished month with an active (non-invalidated, non-superseded)
 *   close → `closed`, window = the full calendar month;
 * - finished month without one (or whose close went stale) →
 *   `provisional`, window = the full calendar month.
 */
export async function resolveReportPeriod(
  closes: Pick<PeriodCloseRepositoryPort, "findActiveByPeriod">,
  clock: Clock,
  input: ResolveReportPeriodInput,
): Promise<Result<ReportPeriod, DomainError>> {
  const currency = CurrencyCode.create(input.currency);
  if (!currency.ok) {
    return currency;
  }

  const period = calendarMonthPeriod(input.year, input.month);
  if (!period.ok) {
    return period;
  }

  const now = clock.now();
  const finished = isCalendarMonthFinished(
    now,
    input.timezone,
    input.year,
    input.month,
  );
  if (!finished.ok) {
    return finished;
  }

  if (!finished.value) {
    const to = localCalendarDateInTimezone(now, input.timezone);
    return ok({
      from: shiftCalendarDays(to, -(PROVISIONAL_WINDOW_DAYS - 1)),
      to,
      currency: currency.value.code,
      periodStatus: "provisional",
    });
  }

  const close = await closes.findActiveByPeriod(
    input.workspaceId,
    currency.value.code,
    period.value.start,
  );
  const closed = close !== null && !close.stale;
  return ok({
    from: period.value.start,
    to: period.value.end,
    currency: currency.value.code,
    periodStatus: closed ? "closed" : "provisional",
  });
}
