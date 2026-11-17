export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

const pad = (n: number): string => String(n).padStart(2, "0");

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * First and last day of the local month containing `now` — the default
 * visualization period of the ledger (S12-5).
 */
export function currentMonthRange(now: Date = new Date()): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
}

/**
 * Rolling 30-day window ending on `now`'s local date (inclusive) — the
 * "Últimos 30 días" period shortcut (S5).
 */
export function last30DaysRange(now: Date = new Date()): DateRange {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}
