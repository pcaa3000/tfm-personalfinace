import { CurrencyCode } from "../../shared-kernel/index.js";
import type { WorkspaceCurrency } from "../domain/workspace-currency.js";

export interface CurrencyView {
  readonly id: string;
  readonly workspaceId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameEs: string;
  readonly minorUnitExponent: number;
  readonly archivedAt: string | null;
}

export function toCurrencyView(currency: WorkspaceCurrency): CurrencyView {
  const entry = CurrencyCode.iso4217Catalog().find(
    (c) => c.code === currency.code.code,
  );
  return {
    id: currency.id,
    workspaceId: currency.workspaceId.value,
    code: currency.code.code,
    nameEn: entry?.nameEn ?? currency.code.code,
    nameEs: entry?.nameEs ?? currency.code.code,
    minorUnitExponent: currency.code.minorUnitExponent,
    archivedAt: currency.archivedAt?.toISOString() ?? null,
  };
}
