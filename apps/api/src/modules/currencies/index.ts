// Public API of the currencies module.
// Owns the workspace currency catalog (ISO 4217 codes, INV-MON-01..04)
// and exposes the ISO table for searchable selectors.
export { WorkspaceCurrency } from "./domain/workspace-currency.js";
export type { WorkspaceCurrencyState } from "./domain/workspace-currency.js";
export {
  CURRENCY_REPOSITORY,
  type CurrencyRepositoryPort,
} from "./application/ports/currency-repository.port.js";
export {
  CURRENCY_USAGE,
  type CurrencyUsage,
  type CurrencyUsagePort,
} from "./application/ports/currency-usage.port.js";
export { AddCurrencyUseCase } from "./application/add-currency.use-case.js";
export { ListCurrenciesUseCase } from "./application/list-currencies.use-case.js";
export { ListIsoCatalogUseCase } from "./application/list-iso-catalog.use-case.js";
export { ReviseCurrencyUseCase } from "./application/revise-currency.use-case.js";
export { ArchiveCurrencyUseCase } from "./application/archive-currency.use-case.js";
export { toCurrencyView, type CurrencyView } from "./application/currency.view.js";
export type { IsoCurrencyView } from "./application/iso-currency.view.js";
export { DrizzleCurrencyRepository } from "./infrastructure/drizzle-currency.repository.js";
export { DrizzleCurrencyUsageAdapter } from "./infrastructure/drizzle-currency-usage.adapter.js";
