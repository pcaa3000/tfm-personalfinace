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
