/**
 * Content hashing for upload dedup (receipt-scan-drafts T13, S12).
 * A port because application/ must stay free of node:crypto
 * (depcruise no-external-deps-in-core) — the production adapter is
 * `CryptoFileHasher` (node:crypto SHA-256).
 */
export interface FileHasherPort {
  /** Lowercase hex digest of the exact bytes — same bytes, same hash. */
  sha256Hex(bytes: Uint8Array): string;
}

export const FILE_HASHER = Symbol("FILE_HASHER");
