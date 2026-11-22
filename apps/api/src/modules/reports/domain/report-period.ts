/**
 * Resolved report window shared by every monthly report (reports-monthly
 * T3–T6, S5): a `closed` period is a calendar month fully ended in the
 * workspace timezone with an active close; anything else is `provisional`
 * — the full month when it already ended without close, or the rolling
 * 30-day window ending today when the month is still running.
 */
export type ReportPeriodStatus = "provisional" | "closed";

export interface ReportPeriod {
  /** Inclusive bounds as YYYY-MM-DD business dates. */
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly periodStatus: ReportPeriodStatus;
}

/**
 * Pure calendar math on a YYYY-MM-DD date (UTC arithmetic, no timezone
 * drift): returns the date `deltaDays` away — `shiftCalendarDays(d, -29)`
 * is the start of the 30-day window ending on `d`.
 */
export function shiftCalendarDays(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + deltaDays));
  return date.toISOString().slice(0, 10);
}
