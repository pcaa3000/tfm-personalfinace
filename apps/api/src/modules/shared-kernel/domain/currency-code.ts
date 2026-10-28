import { DomainError } from "./domain-error.js";
import { err, ok, type Result } from "./result.js";

// ISO 4217 minor-unit exponents that differ from the default of 2.
// Codes absent from this table fall back to exponent 2.
const NON_DEFAULT_MINOR_UNITS: Readonly<Record<string, number>> = {
  // Zero-decimal currencies.
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // Three-decimal currencies.
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // Four-decimal currencies.
  CLF: 4,
  UYW: 4,
};

const DEFAULT_MINOR_UNIT = 2;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export class CurrencyCode {
  private constructor(readonly code: string) {}

  static create(raw: string): Result<CurrencyCode, DomainError> {
    if (!ISO_4217_PATTERN.test(raw)) {
      return err(
        new DomainError(
          "CURRENCY_INVALID_CODE",
          `Currency code must be a 3-letter ISO 4217 code, got: ${JSON.stringify(raw)}`,
        ),
      );
    }
    return ok(new CurrencyCode(raw));
  }

  get minorUnitExponent(): number {
    return NON_DEFAULT_MINOR_UNITS[this.code] ?? DEFAULT_MINOR_UNIT;
  }

  equals(other: CurrencyCode): boolean {
    return this.code === other.code;
  }

  toString(): string {
    return this.code;
  }
}
