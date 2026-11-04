import { defaultCurrencyExponent } from "./summarize";
import type { CurrencyView } from "./types";

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

/** Weekday + day grouping title for the mobile day cards ("viernes 20"). */
export function formatDayTitle(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  PEN: "S/",
  USD: "$",
  EUR: "€",
};

/** Display symbol for a currency; falls back to the ISO code itself. */
export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

/**
 * Builds the exponent resolver used by summaries and amount rendering
 * from the workspace currency catalog (S12-4).
 */
export function currencyExponentResolver(
  currencies: CurrencyView[],
): (code: string) => number {
  const map = new Map(currencies.map((c) => [c.code, c.minorUnitExponent]));
  return (code) => map.get(code) ?? defaultCurrencyExponent(code);
}

/** Canonical decimal string for a minor-unit amount. */
export function minorToDecimalString(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor)
    .toString()
    .padStart(exponent + 1, "0");
  const intPart = digits.slice(0, -exponent) || "0";
  const fracPart = exponent === 0 ? "" : `.${digits.slice(-exponent)}`;
  return `${negative ? "-" : ""}${intPart}${fracPart}`;
}
