/** YYYY-MM-DD business date rendered in the active locale (UTC-safe). */
export function formatBusinessDate(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

/** ISO instant rendered in the active locale. */
export function formatInstant(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
