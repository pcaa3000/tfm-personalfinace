import type { Clock, IdGenerator } from "../../ledger/index.js";
import {
  CurrencyCode,
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import {
  PeriodClose,
  calendarMonthPeriod,
  isCalendarMonthFinished,
} from "../domain/period-close.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import {
  toPeriodCloseView,
  type PeriodCloseView,
} from "./period-close.view.js";

export interface ClosePeriodCommand {
  readonly workspaceId: WorkspaceId;
  readonly currency: string;
  readonly year: number;
  readonly month: number;
  /**
   * Workspace timezone resolved server-side (auth context); the calendar
   * month must be fully ended in this timezone — never client input.
   */
  readonly timezone: string;
  readonly integrityConfirmed: boolean;
  readonly actor: string;
}

/**
 * Minimal monthly close (reports-monthly T2, S5): one close per
 * workspace+currency+calendar month. Only months fully ended in the
 * workspace timezone close; the running month stays provisional
 * (computed by the report tasks, never stored). Re-closing a period whose
 * previous close went stale supersedes it — history is kept, never
 * rewritten.
 */
export class ClosePeriodUseCase {
  constructor(
    private readonly closes: PeriodCloseRepositoryPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    command: ClosePeriodCommand,
  ): Promise<Result<PeriodCloseView, DomainError>> {
    const currency = CurrencyCode.create(command.currency);
    if (!currency.ok) {
      return currency;
    }

    const period = calendarMonthPeriod(command.year, command.month);
    if (!period.ok) {
      return period;
    }

    const finished = isCalendarMonthFinished(
      this.clock.now(),
      command.timezone,
      command.year,
      command.month,
    );
    if (!finished.ok) {
      return finished;
    }
    if (!finished.value) {
      return err(
        new DomainError(
          "PERIOD_NOT_FINISHED",
          `Calendar month ${command.year}-${command.month} has not fully ended in timezone ${command.timezone}`,
        ),
      );
    }

    if (command.integrityConfirmed !== true) {
      return err(
        new DomainError(
          "PERIOD_CLOSE_INTEGRITY_REQUIRED",
          "Closing a period requires the integrity declaration",
        ),
      );
    }

    const existing = await this.closes.findActiveByPeriod(
      command.workspaceId,
      currency.value.code,
      period.value.start,
    );
    const now = this.clock.now();
    if (existing !== null) {
      if (!existing.stale) {
        return err(
          new DomainError(
            "PERIOD_ALREADY_CLOSED",
            `Period ${period.value.start} is already closed for ${currency.value.code}`,
          ),
        );
      }
      // Stale close: supersede it — the row stays for history.
      existing.markSuperseded(now);
      await this.closes.save(existing);
    }

    const created = PeriodClose.close({
      id: this.ids.next(),
      workspaceId: command.workspaceId,
      currency: currency.value.code,
      periodStart: period.value.start,
      periodEnd: period.value.end,
      timezone: command.timezone,
      integrityDeclared: command.integrityConfirmed,
      closedAt: now,
      createdAt: now,
    });
    if (!created.ok) {
      return created;
    }

    await this.closes.save(created.value);
    return ok(toPeriodCloseView(created.value));
  }
}
