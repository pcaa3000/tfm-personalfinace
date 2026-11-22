/**
 * Display helpers for the reports page (reports-monthly T7). Report
 * amounts arrive as decimal strings (INV-DIN-03 — never floats on the
 * wire); converting to Number only happens here, for display.
 */

/** Decimal string rendered in the locale currency format. */
export function formatReportAmount(
  decimal: string,
  currency: string,
  locale: string,
): string {
  const value = Number(decimal);
  if (!Number.isFinite(value)) return decimal;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    // Unknown/non-ISO currency code — degrade to "<decimal> <code>".
    return `${decimal} ${currency}`;
  }
}

/**
 * Percentage rendered with the locale decimal separator, trimming
 * trailing zeros. Accepts the API's percent fields (numbers like
 * `percentOfExpenses` and strings like `observedRate`).
 */
export function formatReportPercent(
  value: number | string,
  locale: string,
): string {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(parsed)) return "—";
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(parsed)}%`;
}

/** Long localized month name for a 1–12 month number. */
export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, month - 1, 1)));
}
