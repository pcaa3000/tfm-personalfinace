import {
  DomainError,
  WorkspaceId,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock, IdGenerator } from "../../ledger/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import {
  extensionForMime,
  validateReceiptUpload,
} from "../domain/receipt-upload.js";
import type { FileHasherPort } from "./ports/file-hasher.port.js";
import type { ReceiptFileHashPort } from "./ports/receipt-file-hash.port.js";
import type { ReceiptScanDispatcher } from "./ports/receipt-scan-dispatcher.port.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import { toReceiptScanView, type ReceiptScanView } from "./receipt-scan.view.js";

export interface UploadReceiptCommand {
  readonly workspaceId: WorkspaceId;
  readonly uploaderSubject: string;
  readonly originalFilename: string;
  readonly bytes: Uint8Array;
}

export interface ReceiptUploadPolicy {
  /** RECEIPT_MAX_BYTES — quarantine size cap (default 5 MiB). */
  readonly maxBytes: number;
}

const FILENAME_MAX_LENGTH = 255;
const FALLBACK_FILENAME = "receipt";

/**
 * Upload + quarantine (receipt-scan-drafts T3, S1+S9):
 *   validate (magic bytes + size) → store under a quarantine key →
 *   insert `pending` row → enqueue `receipt-scan` (payload {receiptId}).
 *
 * Validation runs BEFORE storage: a rejected upload leaves no object and
 * no row. A dispatch failure is logged but does not fail the request —
 * the pending row remains the recoverable source of truth.
 */
export class UploadReceiptUseCase {
  constructor(
    private readonly storage: ReceiptStoragePort,
    private readonly scans: ReceiptScanRepositoryPort,
    private readonly fileHashes: ReceiptFileHashPort,
    private readonly hasher: FileHasherPort,
    private readonly dispatcher: ReceiptScanDispatcher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: ReceiptUploadPolicy,
  ) {}

  async execute(
    command: UploadReceiptCommand,
  ): Promise<Result<ReceiptScanView, DomainError>> {
    const valid = validateReceiptUpload({
      bytes: command.bytes,
      maxBytes: this.policy.maxBytes,
    });
    if (!valid.ok) {
      return valid;
    }

    // T13 (S12) nivel 1: exact-hash dedup — the SAME bytes already
    // uploaded in this workspace return the existing scan unchanged
    // (idempotent: no second file, row or job). A `failed` scan is
    // returned as-is too — POST /:id/retry owns the re-enqueue.
    const fileHash = this.hasher.sha256Hex(command.bytes);
    const existing = await this.fileHashes.findByFileHash(
      command.workspaceId,
      fileHash,
    );
    if (existing) {
      return ok(toReceiptScanView(existing));
    }

    const id = this.ids.next();
    // Key extension follows the sniffed MIME, never the client filename.
    const key = `quarantine/${command.workspaceId.value}/${id}.${extensionForMime(valid.value.mimeType)}`;
    const storageKey = await this.storage.save(
      key,
      command.bytes,
      valid.value.mimeType,
    );

    const filename = sanitizeFilename(command.originalFilename);
    const scan = ReceiptScan.quarantine({
      id,
      workspaceId: command.workspaceId,
      uploaderSubject: command.uploaderSubject,
      storageKey,
      originalFilename: filename,
      mimeType: valid.value.mimeType,
      sizeBytes: command.bytes.byteLength,
      fileHash,
      now: this.clock.now(),
    });
    if (!scan.ok) {
      return scan;
    }
    try {
      await this.scans.save(scan.value);
    } catch (cause) {
      // T13 (S12): a concurrent identical upload can race past the
      // lookup above and hit UNIQUE(workspaceId, fileHash) on insert.
      // Best-effort: re-read the winner and return it — the response is
      // identical to the serialized dedup path. Any other insert
      // failure propagates unchanged.
      const winner = await this.fileHashes
        .findByFileHash(command.workspaceId, fileHash)
        .catch(() => null);
      if (winner) {
        return ok(toReceiptScanView(winner));
      }
      throw cause;
    }

    try {
      await this.dispatcher.enqueueScan(id, command.workspaceId.value);
    } catch (cause) {
      console.error(
        `[receipts] failed to enqueue receipt-scan job for ${id}:`,
        cause,
      );
    }

    return ok(toReceiptScanView(scan.value));
  }
}

const FORBIDDEN_FILENAME_CHARS = new Set('<>:"|?*');

/** Strips path segments/control chars and bounds the stored filename. */
function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter(
      (c) =>
        c.charCodeAt(0) >= 0x20 &&
        c.charCodeAt(0) !== 0x7f &&
        !FORBIDDEN_FILENAME_CHARS.has(c),
    )
    .join("")
    .trim()
    .slice(0, FILENAME_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : FALLBACK_FILENAME;
}
