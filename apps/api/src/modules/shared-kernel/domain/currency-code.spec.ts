import { describe, expect, it } from "vitest";

import { CurrencyCode } from "./currency-code.js";

describe("CurrencyCode", () => {
  it.each(["EUR", "USD", "JPY", "BHD", "ARS"])("accepts ISO 4217 code %s", (code) => {
    const result = CurrencyCode.create(code);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe(code);
    }
  });

  it.each(["eur", "EU", "EURO", "E1R", "123", "", " EUR "])(
    "rejects malformed code %j",
    (code) => {
      const result = CurrencyCode.create(code);

      expect(result.ok).toBe(false);
    },
  );

  it.each([
    ["JPY", 0],
    ["KRW", 0],
    ["EUR", 2],
    ["USD", 2],
    ["BHD", 3],
    ["KWD", 3],
    ["CLF", 4],
  ])("exposes ISO minor unit exponent for %s", (code, exponent) => {
    const result = CurrencyCode.create(code);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnitExponent).toBe(exponent);
    }
  });

  it("defaults to exponent 2 for well-formed but untabled codes", () => {
    const result = CurrencyCode.create("ZZZ");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.minorUnitExponent).toBe(2);
    }
  });
});
