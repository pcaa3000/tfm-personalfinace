import {
  BusinessDate,
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/**
 * Minimum monthly close per workspace + currency + period
 * (reports-monthly T2, S5 — docs/04 "Cierre mensual").
 *
 * A close records that the user declared the ledger complete for a
 * calendar month already finished in the workspace timezone. It is never
 * rewritten: a later revision/void only marks it stale (`invalidatedAt`),
 * and closing the same period again supersedes the stale row
 * (`supersededAt`) instead of editing it.
 */
export interface PeriodCloseState {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly currency: string;
  /** Inclusive period bounds as YYYY-MM-DD calendar dates. */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Workspace timezone snapshot at close time. */
  readonly timezone: string;
  readonly integrityDeclared: boolean;
  readonly closedAt: Date;
  readonly invalidatedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly createdAt: Date;
}

export interface ClosePeriodInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timezone: string;
  readonly integrityDeclared: boolean;
  readonly closedAt: Date;
  readonly createdAt: Date;
}

export class PeriodClose {
  private _invalidatedAt: Date | null;
  private _supersededAt: Date | null;

  private constructor(private readonly state: PeriodCloseState) {
    this._invalidatedAt = state.invalidatedAt;
    this._supersededAt = state.supersededAt;
  }

  /**
   * Declares a new close. The integrity declaration is a domain
   * invariant: a close without it must never reach persistence.
   */
  static close(input: ClosePeriodInput): Result<PeriodClose, DomainError> {
    if (input.integrityDeclared !== true) {
      return err(
        new DomainError(
          "PERIOD_CLOSE_INTEGRITY_REQUIRED",
          "Closing a period requires the integrity declaration",
        ),
      );
    }
    return ok(
      new PeriodClose({
        id: input.id,
        workspaceId: input.workspaceId,
        currency: input.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        timezone: input.timezone,
        integrityDeclared: true,
        closedAt: input.closedAt,
        invalidatedAt: null,
        supersededAt: null,
        createdAt: input.createdAt,
      }),
    );
  }

  /** Rebuilds a persisted close; trusts stored state (mappers only). */
  static reconstitute(state: PeriodCloseState): PeriodClose {
    return new PeriodClose(state);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): WorkspaceId {
    return this.state.workspaceId;
  }
  get currency(): string {
    return this.state.currency;
  }
  get periodStart(): string {
    return this.state.periodStart;
  }
  get periodEnd(): string {
    return this.state.periodEnd;
  }
  get timezone(): string {
    return this.state.timezone;
  }
  get integrityDeclared(): boolean {
    return this.state.integrityDeclared;
  }
  get closedAt(): Date {
    return this.state.closedAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get invalidatedAt(): Date | null {
    return this._invalidatedAt;
  }
  get supersededAt(): Date | null {
    return this._supersededAt;
  }

  /**
   * A close is stale once a post-close ledger change touched its period;
   * it stays listed (marked) until a re-close supersedes it.
   */
  get stale(): boolean {
    return this._invalidatedAt !== null;
  }

  markInvalidated(at: Date): void {
    if (this._invalidatedAt === null) {
      this._invalidatedAt = at;
    }
  }

  markSuperseded(at: Date): void {
    if (this._supersededAt === null) {
      this._supersededAt = at;
    }
  }
}

export interface MonthPeriod {
  readonly start: string;
  readonly end: string;
}

/**
 * Inclusive bounds of a calendar month as YYYY-MM-DD strings. `month` is
 * 1-based; out-of-range values are rejected rather than rolled over.
 */
export function calendarMonthPeriod(
  year: number,
  month: number,
): Result<MonthPeriod, DomainError> {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 1 ||
    year > 9999
  ) {
    return err(
      new DomainError(
        "PERIOD_INVALID",
        `Period must be a real calendar month, got year=${year} month=${month}`,
      ),
    );
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return ok({
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  });
}

/**
 * The YYYY-MM-DD calendar day an instant falls on inside a timezone.
 * Used by the provisional 30-day window (T3–T6) to anchor "today" to the
 * workspace-local date, not to UTC.
 */
export function localCalendarDateInTimezone(
  instant: Date,
  timezone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

function localDateInTimezone(
  instant: Date,
  timezone: string,
): { year: number; month: number } {
  const [year, month] = localCalendarDateInTimezone(instant, timezone)
    .split("-")
    .map(Number);
  return { year: year ?? 0, month: month ?? 0 };
}

/**
 * S5 rule: only calendar months fully ended in the workspace timezone may
 * close. The current local month (and any future one) is rejected — the
 * month is finished only when the local calendar has already moved past
 * it, so an instant on the last local day still counts as unfinished.
 */
export function isCalendarMonthFinished(
  instant: Date,
  timezone: string,
  year: number,
  month: number,
): Result<boolean, DomainError> {
  // Reuses the shared IANA-timezone validation (TIMEZONE_INVALID).
  const probe = BusinessDate.create("2000-01-01", timezone);
  if (!probe.ok) {
    return probe;
  }
  const local = localDateInTimezone(instant, timezone);
  return ok(local.year * 12 + (local.month - 1) > year * 12 + (month - 1));
}
