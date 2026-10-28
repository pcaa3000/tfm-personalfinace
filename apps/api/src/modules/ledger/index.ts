// Public API of the ledger module (book of income/expense transactions).
// Other modules consume use cases and read models exposed here; internal
// layers (domain/, application/, infrastructure/) are not importable.
export {
  Transaction,
  UNCATEGORIZED,
  categorized,
  type CategoryAssignment,
  type RecordManualInput,
  type ReviseInput,
  type TransactionState,
  type TransactionOrigin,
  type TransactionStatus,
  type TransactionType,
} from "./domain/transaction.js";
export {
  TransactionRevision,
  type FieldChange,
  type RevisionField,
  type RevisionKind,
} from "./domain/transaction-revision.js";
export {
  TRANSACTION_REPOSITORY,
  type TransactionFilter,
  type TransactionRepositoryPort,
} from "./application/ports/transaction-repository.port.js";
export {
  CATEGORY_VALIDATION,
  type CategoryValidationPort,
} from "./application/ports/category-validation.port.js";
export { CLOCK, type Clock } from "./application/ports/clock.port.js";
export { ID_GENERATOR, type IdGenerator } from "./application/ports/id-generator.port.js";
export {
  RecordManualTransactionUseCase,
  type RecordManualTransactionCommand,
} from "./application/record-manual-transaction.use-case.js";
export { ListTransactionsUseCase } from "./application/list-transactions.use-case.js";
export { toTransactionView, type TransactionView } from "./application/transaction.view.js";
