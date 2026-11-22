import { describe, expect, it } from "vitest";

import {
  formatReportAmount,
  formatReportPercent,
  monthName,
} from "./format";

describe("formatReportAmount (reports-monthly T7)", () => {
  it("renders a decimal string in the locale currency format", () => {
    const result = formatReportAmount("1234.50", "PEN", "es");

    // Generic 'es' renders the ISO code (ICU), not the local symbol.
    expect(result).toContain("234,50");
    expect(result).toContain("PEN");
  });

  it("keeps negative amounts", () => {
    const result = formatReportAmount("-250.00", "PEN", "es");

    expect(result).toContain("250,00");
    expect(result).toMatch(/−|-/);
  });

  it("falls back to '<decimal> <code>' for an unknown currency code", () => {
    expect(formatReportAmount("10.00", "NOPE", "es")).toBe("10.00 NOPE");
  });
});

describe("formatReportPercent", () => {
  it("formats a numeric percent with the locale decimal separator", () => {
    expect(formatReportPercent(66.67, "es")).toBe("66,67%");
  });

  it("accepts the API percent strings (e.g. savings observedRate)", () => {
    expect(formatReportPercent("76.00", "es")).toBe("76%");
    expect(formatReportPercent("0.50", "en")).toBe("0.5%");
  });
});

describe("monthName", () => {
  it("returns the localized month name for a 1-12 month number", () => {
    expect(monthName(11, "es")).toBe("noviembre");
    expect(monthName(11, "en")).toBe("November");
  });
});
