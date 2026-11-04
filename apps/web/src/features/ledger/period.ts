export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

const pad = (n: number): string => String(n).padStart(2, "0");

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
