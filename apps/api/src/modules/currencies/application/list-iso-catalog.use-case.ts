import { CurrencyCode } from "../../shared-kernel/index.js";
import type { IsoCurrencyView } from "./iso-currency.view.js";

/**
 * Exposes the full ISO 4217 table so the UI can render a searchable
 * selector (code or name, e.g. 'pesos', 'soles', 'dólar') and add
 * currencies per row (S12, L20/L21).
 */
export class ListIsoCatalogUseCase {
  execute(): IsoCurrencyView[] {
    return CurrencyCode.iso4217Catalog().map((entry) => ({
      code: entry.code,
      nameEn: entry.nameEn,
      nameEs: entry.nameEs,
      minorUnitExponent: entry.minorUnitExponent,
    }));
  }
}
