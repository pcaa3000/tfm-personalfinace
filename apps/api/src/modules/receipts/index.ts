// Public API of the receipts module (receipt-scan-drafts: voucher/ticket
// scan → quarantine → async extraction → draft transaction). Other
// modules consume use cases and read models exposed here; internal
// layers (domain/, application/, infrastructure/) are not importable.
export {
  ReceiptScan,
  RECEIPT_SCAN_STATUSES,
  type QuarantineScanInput,
  type ReceiptScanState,
  type ReceiptScanStatus,
} from "./domain/receipt-scan.js";
export {
  RECEIPT_MAX_BYTES_DEFAULT,
  RECEIPT_MIME_ALLOWLIST,
  sniffReceiptMime,
  validateReceiptUpload,
  type ReceiptMime,
} from "./domain/receipt-upload.js";
export {
  RECEIPT_STORAGE,
  type ReceiptStoragePort,
} from "./application/ports/receipt-storage.port.js";
export {
  RECEIPT_SCAN_REPOSITORY,
  type ReceiptScanListPort,
  type ReceiptScanListQuery,
  type ReceiptScanListSlice,
  type ReceiptScanRepositoryPort,
} from "./application/ports/receipt-scan-repository.port.js";
export {
  decodeReceiptScanCursor,
  encodeReceiptScanCursor,
  type ReceiptScanCursor,
} from "./application/receipt-scan-cursor.js";
export {
  RECEIPT_SCAN_DISPATCHER,
  RECEIPT_SCAN_QUEUE,
  type ReceiptScanDispatcher,
} from "./application/ports/receipt-scan-dispatcher.port.js";
export {
  RECEIPT_SCANNER,
  type ReceiptScanPort,
} from "./application/ports/receipt-scan.port.js";
export {
  FILE_HASHER,
  type FileHasherPort,
} from "./application/ports/file-hasher.port.js";
export {
  RECEIPT_FILE_HASH,
  type ReceiptFileHashPort,
} from "./application/ports/receipt-file-hash.port.js";
export {
  TRANSACTION_DUPLICATES,
  type TransactionDuplicateCriteria,
  type TransactionDuplicatesPort,
} from "./application/ports/transaction-duplicates.port.js";
export type {
  ReceiptScanExtraction,
  ReceiptScanItem,
  ReceiptScanNewCategorySuggestion,
} from "./domain/receipt-scan-extraction.js";
export {
  buildReceiptDraft,
  RECEIPT_LOW_CONFIDENCE,
  type ReceiptDraftNewCategory,
  type ReceiptDraftPayload,
  type ReceiptDraftPossibleDuplicate,
  type ReceiptDraftSplit,
} from "./domain/receipt-draft.js";
export {
  UploadReceiptUseCase,
  type ReceiptUploadPolicy,
  type UploadReceiptCommand,
} from "./application/upload-receipt.use-case.js";
export { GetReceiptScanUseCase } from "./application/get-receipt-scan.use-case.js";
export {
  ListReceiptScansUseCase,
  type ReceiptScanListPage,
} from "./application/list-receipt-scans.use-case.js";
export { GetReceiptDraftUseCase } from "./application/get-receipt-draft.use-case.js";
export { RejectReceiptScanUseCase } from "./application/reject-receipt-scan.use-case.js";
export { RetryReceiptScanUseCase } from "./application/retry-receipt-scan.use-case.js";
export {
  ConfirmReceiptDraftUseCase,
  type ConfirmReceiptDraftCommand,
  type ConfirmReceiptDraftResult,
  type ConfirmReceiptSplitInput,
} from "./application/confirm-receipt-draft.use-case.js";
export {
  GetReceiptFileUseCase,
  type ReceiptFileView,
} from "./application/get-receipt-file.use-case.js";
export { DeleteReceiptFileUseCase } from "./application/delete-receipt-file.use-case.js";
export {
  toReceiptScanListItem,
  toReceiptScanView,
  type ReceiptScanListItem,
  type ReceiptScanView,
} from "./application/receipt-scan.view.js";
export { LocalReceiptStorage } from "./infrastructure/local-receipt-storage.js";
export {
  S3ReceiptStorage,
  type S3ReceiptStorageConfig,
} from "./infrastructure/s3-receipt-storage.js";
export { DrizzleReceiptScanRepository } from "./infrastructure/drizzle-receipt-scan.repository.js";
export { DrizzleTransactionDuplicatesAdapter } from "./infrastructure/drizzle-transaction-duplicates.adapter.js";
export { CryptoFileHasher } from "./infrastructure/crypto-file-hasher.adapter.js";
export { PgBossReceiptScanDispatcher } from "./infrastructure/pgboss-receipt-scan.dispatcher.js";
export {
  GeminiReceiptScanAdapter,
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  type GeminiReceiptScanConfig,
} from "./infrastructure/gemini-receipt-scan.adapter.js";
export {
  InlineReceiptScanDispatcher,
  type InlineReceiptScanDispatcherOptions,
  type InlineScanJob,
  type InlineScanRunner,
} from "./infrastructure/inline-receipt-scan.dispatcher.js";
