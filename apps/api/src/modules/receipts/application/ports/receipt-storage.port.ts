/**
 * Object-store port for receipt bytes (receipt-scan-drafts D2, S9).
 * Drivers: `local` (filesystem under RECEIPT_STORAGE_DIR, dev default)
 * and `s3` (S3-compatible: Supabase Storage S3 endpoint or MinIO).
 * Implementations live in infrastructure/ and are framework-tolerant —
 * the port only speaks keys and bytes.
 */
export interface ReceiptStoragePort {
  /**
   * Persists `bytes` under `key` (a server-generated, workspace-scoped
   * quarantine path) and returns the storage key the row must record.
   */
  save(key: string, bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Reads the object back; null when absent. */
  open(key: string): Promise<Uint8Array | null>;
}

export const RECEIPT_STORAGE = Symbol("RECEIPT_STORAGE");
