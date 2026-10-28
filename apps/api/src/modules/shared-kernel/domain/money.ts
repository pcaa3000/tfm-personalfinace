import { CurrencyCode } from "./currency-code.js";
import { DomainError } from "./domain-error.js";
import { err, ok, type Result } from "./result.js";

const AMOUNT_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_INTEGER_DIGITS = 39;

/**
 * Exact decimal money expressed in minor units (bigint), never binary float.
 * The scale is the ISO 4217 exponent of its currency.
 */
export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static create(raw: string, currencyCode: string): Result<Money, DomainError> {
    const currency = CurrencyCode.create(currencyCode);
    if (!currency.ok) {
      return currency;
    }
    return Money.createIn(raw, currency.value);
  }

  static createIn(raw: string, currency: CurrencyCode): Result<Money, DomainError> {
    const match = AMOUNT_PATTERN.exec(raw.trim());
    if (!match) {
      return err(
        new DomainError(
          "MONEY_INVALID_AMOUNT",
          `Amount must be a plain decimal, got: ${JSON.stringify(raw)}`,
        ),
      );
    }

    const sign = match[1] === "-" ? -1n : 1n;
    const integerPart = match[2] ?? "0";
    const fractionPart = match[3] ?? "";

    if (integerPart.length > MAX_INTEGER_DIGITS) {
      return err(
        new DomainError(
          "MONEY_INVALID_AMOUNT",
          `Amount exceeds ${MAX_INTEGER_DIGITS} integer digits`,
        ),
      );
    }

    const exponent = currency.minorUnitExponent;
    if (fractionPart.length > exponent) {
      return err(
        new DomainError(
          "MONEY_SCALE_EXCEEDED",
          `Amount ${raw} has more decimals than ${currency.code} allows (${exponent})`,
        ),
      );
    }

    const minorUnits =
      sign * BigInt(integerPart + fractionPart.padEnd(exponent, "0"));

    return ok(new Money(minorUnits, currency));
  }

  static fromMinorUnits(
    minorUnits: bigint,
    currencyCode: string,
  ): Result<Money, DomainError> {
    const currency = CurrencyCode.create(currencyCode);
    if (!currency.ok) {
      return currency;
    }
    return ok(new Money(minorUnits, currency.value));
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  equals(other: Money): boolean {
    return (
      this.currency.equals(other.currency) &&
      this.minorUnits === other.minorUnits
    );
  }

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  /** Canonical decimal string padded to the currency exponent. */
  toDecimalString(): string {
    const exponent = this.currency.minorUnitExponent;
    const sign = this.minorUnits < 0n ? "-" : "";
    const digits = this.minorUnits.toString().replace("-", "");
    if (exponent === 0) {
      return sign + digits;
    }
    const padded = digits.padStart(exponent + 1, "0");
    const integerPart = padded.slice(0, -exponent);
    const fractionPart = padded.slice(-exponent);
    return `${sign}${integerPart}.${fractionPart}`;
  }

  private assertSameCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) {
      throw new DomainError(
        "MONEY_CURRENCY_MISMATCH",
        `Cannot operate on ${this.currency.code} and ${other.currency.code}`,
      );
    }
  }
}
