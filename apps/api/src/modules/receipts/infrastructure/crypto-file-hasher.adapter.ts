import { createHash } from "node:crypto";

import type { FileHasherPort } from "../application/ports/file-hasher.port.js";

/**
 * SHA-256 hex over the uploaded bytes (receipt-scan-drafts T13, S12).
 * Lives in infrastructure because application/ is node:crypto-free
 * (depcruise no-external-deps-in-core).
 */
export class CryptoFileHasher implements FileHasherPort {
  sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }
}
