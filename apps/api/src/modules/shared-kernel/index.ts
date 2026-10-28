// Public API of the shared-kernel module.
// Only stable, framework-free concepts live here (Money, CurrencyCode,
// BusinessDate, WorkspaceId, Result). Other modules may import this barrel
// but never internal files.
export { BusinessDate } from "./domain/business-date.js";
export { CurrencyCode } from "./domain/currency-code.js";
export { DomainError } from "./domain/domain-error.js";
export { Money } from "./domain/money.js";
export { err, ok, type Result } from "./domain/result.js";
export { WorkspaceId } from "./domain/workspace-id.js";
