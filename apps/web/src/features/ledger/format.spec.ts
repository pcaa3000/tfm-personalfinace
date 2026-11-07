import { describe, expect, it } from "vitest";

import {
  currencyExponentResolver,
  currencySymbol,
  formatBusinessDate,
  formatDayTitle,
  formatInstant,
  minorToDecimalString,
} from "./format";
import type { CurrencyView } from "./types";

describe("formatBusinessDate", () => {
  it("renders the business date in UTC regardless of host timezone", () => {
    // Host TZ is America/Lima (UTC-5): parsing the date as local time or
    // formatting it in local time would shift the day to 30/9.
    expect(formatBusinessDate("2026-10-01", "es")).toBe("1/10/2026");
    expect(formatBusinessDate("2026-10-01", "en-US")).toBe("10/1/2026");
  });
});

describe("formatInstant", () => {
  it("renders an ISO instant with short date and time in the locale", () => {
    const iso = "2026-10-02T15:30:00.000Z";
    const expected = new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));

    expect(formatInstant(iso, "en-US")).toBe(expected);
    expect(formatInstant(iso, "es")).toBe(
      new Intl.DateTimeFormat("es", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(iso)),
    );
  });
});

describe("formatDayTitle", () => {
  it("renders the weekday and day in UTC", () => {
    // 2026-10-01 is a Thursday; a local-timezone shift would land on Wednesday.
    expect(formatDayTitle("2026-10-01", "es")).toBe("jueves 1");

    const en = formatDayTitle("2026-10-01", "en-US");
    expect(en).toContain("Thursday");
    expect(en).toContain("1");
  });
});

describe("currencySymbol", () => {
  it("maps known currencies to their display symbol", () => {
    expect(currencySymbol("PEN")).toBe("S/");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });

  it("falls back to the ISO code for unknown currencies", () => {
    expect(currencySymbol("CHF")).toBe("CHF ");
  });
});

describe("currencyExponentResolver", () => {
  const currencies: CurrencyView[] = [
    {
      id: "cur-pen",
      workspaceId: "ws-1",
      code: "PEN",
      nameEn: "Peruvian Sol",
      nameEs: "Sol peruano",
      minorUnitExponent: 2,
      archivedAt: null,
    },
    {
      id: "cur-jpy",
      workspaceId: "ws-1",
      code: "JPY",
      nameEn: "Japanese Yen",
      nameEs: "Yen japonés",
      minorUnitExponent: 0,
      archivedAt: null,
    },
  ];

  it("resolves exponents from the workspace catalog", () => {
    const resolve = currencyExponentResolver(currencies);

    expect(resolve("PEN")).toBe(2);
    expect(resolve("JPY")).toBe(0);
  });

  it("falls back to the ISO exponent table for codes outside the catalog", () => {
    const resolve = currencyExponentResolver(currencies);

    expect(resolve("BHD")).toBe(3);
    expect(resolve("XXX")).toBe(2);
  });
});

describe("minorToDecimalString", () => {
  it("renders minor units with the currency exponent", () => {
    expect(minorToDecimalString(12345n, 2)).toBe("123.45");
    expect(minorToDecimalString(5n, 2)).toBe("0.05");
    expect(minorToDecimalString(123n, 3)).toBe("0.123");
    expect(minorToDecimalString(0n, 2)).toBe("0.00");
  });

  it("keeps the sign for negative amounts", () => {
    expect(minorToDecimalString(-12345n, 2)).toBe("-123.45");
    expect(minorToDecimalString(-5n, 2)).toBe("-0.05");
  });

  it("renders zero-decimal currencies without a fractional part", () => {
    expect(minorToDecimalString(500n, 0)).toBe("500");
    expect(minorToDecimalString(-50n, 0)).toBe("-50");
    expect(minorToDecimalString(0n, 0)).toBe("0");
  });
});
