/**
 * Content hashing for upload dedup (voice-drafts T1, S5). A port
 * because application/ must stay free of node:crypto (depcruise
 * no-external-deps-in-core) — the production adapter is the shared
 * `CryptoFileHasher` (node:crypto SHA-256) reused from the receipts
 * module drivers.
 */
export interface FileHasherPort {
  /** Lowercase hex digest of the exact bytes — same bytes, same hash. */
  sha256Hex(bytes: Uint8Array): string;
}

export const FILE_HASHER = Symbol("FILE_HASHER");
