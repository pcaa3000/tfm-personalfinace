/** One row of the ISO 4217 catalog exposed to the API (S12, L21). */
export interface IsoCurrencyView {
  readonly code: string;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly minorUnitExponent: number;
}
