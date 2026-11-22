import type { PeriodClose } from "../domain/period-close.js";

/**
 * Public shape returned by the period-close endpoints. `stale` flags a
 * close whose period was touched by a later revision/void (S5) — report
 * tasks read it to prefer provisional computation over a stale close.
 */
export interface PeriodCloseView {
  readonly id: string;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timezone: string;
  readonly integrityDeclared: boolean;
  readonly closedAt: string;
  readonly invalidatedAt: string | null;
  readonly supersededAt: string | null;
  readonly stale: boolean;
}

export function toPeriodCloseView(close: PeriodClose): PeriodCloseView {
  return {
    id: close.id,
    currency: close.currency,
    periodStart: close.periodStart,
    periodEnd: close.periodEnd,
    timezone: close.timezone,
    integrityDeclared: close.integrityDeclared,
    closedAt: close.closedAt.toISOString(),
    invalidatedAt: close.invalidatedAt?.toISOString() ?? null,
    supersededAt: close.supersededAt?.toISOString() ?? null,
    stale: close.stale,
  };
}
