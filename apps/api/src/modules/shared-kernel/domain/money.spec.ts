import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error.js";
import { Money } from "./money.js";

describe("Money", () => {
  describe("create", () => {
    it.each([
      ["100.50", "EUR", 10050n, "100.50"],
      ["10", "EUR", 1000n, "10.00"],
      ["10.5", "EUR", 1050n, "10.50"],
      ["0.01", "EUR", 1n, "0.01"],
      ["0", "EUR", 0n, "0.00"],
      ["-5.25", "EUR", -525n, "-5.25"],
      ["1234", "JPY", 1234n, "1234"],
      ["10.001", "BHD", 10001n, "10.001"],
      ["999999999999999999.99", "EUR", 99999999999999999999n, "999999999999999999.99"],
      ["010.50", "EUR", 1050n, "10.50"],
    ])("parses %s %s into exact minor units", (raw, currency, minor, expected) => {
      const result = Money.create(raw, currency);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.minorUnits).toBe(minor);
        expect(result.value.toDecimalString()).toBe(expected);
      }
    });

    it.each([
      ["0.005", "EUR"],
      ["10.0001", "BHD"],
      ["1.5", "JPY"],
    ])("rejects %s %s exceeding the ISO scale", (raw, currency) => {
      const result = Money.create(raw, currency);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MONEY_SCALE_EXCEEDED");
      }
    });

    it.each(["abc", "1.2.3", "", "1,5", "1 000", "1e3", "+-5", "0x10"])(
      "rejects malformed amount %j",
      (raw) => {
        const result = Money.create(raw, "EUR");

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("MONEY_INVALID_AMOUNT");
        }
      },
    );

    it("rejects an invalid currency code", () => {
      const result = Money.create("10", "EU");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CURRENCY_INVALID_CODE");
      }
    });

    it("normalizes negative zero to zero", () => {
      const result = Money.create("-0.00", "EUR");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.minorUnits).toBe(0n);
        expect(result.value.toDecimalString()).toBe("0.00");
      }
    });
  });

  describe("fromMinorUnits", () => {
    it("round-trips minor units", () => {
      const result = Money.fromMinorUnits(12345n, "USD");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toDecimalString()).toBe("123.45");
      }
    });
  });

  describe("arithmetic", () => {
    it("adds and subtracts in the same currency", () => {
      const a = Money.create("10.25", "EUR");
      const b = Money.create("0.75", "EUR");

      if (!a.ok || !b.ok) throw new Error("setup failed");

      expect(a.value.add(b.value).toDecimalString()).toBe("11.00");
      expect(a.value.subtract(b.value).toDecimalString()).toBe("9.50");
      expect(a.value.subtract(a.value).isZero()).toBe(true);
    });

    it("throws a domain error on cross-currency arithmetic", () => {
      const eur = Money.create("1", "EUR");
      const usd = Money.create("1", "USD");

      if (!eur.ok || !usd.ok) throw new Error("setup failed");

      expect(() => eur.value.add(usd.value)).toThrow(DomainError);
      expect(() => eur.value.subtract(usd.value)).toThrow(DomainError);
      expect(() => eur.value.compareTo(usd.value)).toThrow(DomainError);
    });
  });

  describe("comparison", () => {
    it("compares and checks equality in the same currency", () => {
      const a = Money.create("5.00", "EUR");
      const b = Money.create("5", "EUR");
      const c = Money.create("6", "EUR");

      if (!a.ok || !b.ok || !c.ok) throw new Error("setup failed");

      expect(a.value.equals(b.value)).toBe(true);
      expect(a.value.compareTo(b.value)).toBe(0);
      expect(a.value.compareTo(c.value)).toBe(-1);
      expect(c.value.compareTo(a.value)).toBe(1);
      expect(c.value.isPositive()).toBe(true);
      expect(a.value.negate().isPositive()).toBe(false);
      expect(a.value.equals(c.value)).toBe(false);
    });
  });
});
