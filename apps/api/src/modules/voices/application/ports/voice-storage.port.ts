/**
 * Object-store port for voice-note bytes (voice-drafts T1, S5). A thin
 * voices-owned port that deliberately mirrors the receipts storage
 * contract — the SAME local/s3 drivers serve both modules
 * (structurally compatible), so no shared abstraction was extracted
 * and receipts' public surface stays untouched. Implementations live
 * in infrastructure or are wired from the receipts drivers at the
 * composition root; the port only speaks keys and bytes.
 */
export interface VoiceStoragePort {
  /**
   * Persists `bytes` under `key` (a server-generated, workspace-scoped
   * quarantine path) and returns the storage key the row must record.
   */
  save(key: string, bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Reads the object back; null when absent. */
  open(key: string): Promise<Uint8Array | null>;
  /**
   * Deletes the object (retention S7): early user deletion and the
   * scheduled purge share this. Idempotent — an already-absent object
   * is a successful delete, not an error.
   */
  delete(key: string): Promise<void>;
}

export const VOICE_STORAGE = Symbol("VOICE_STORAGE");
