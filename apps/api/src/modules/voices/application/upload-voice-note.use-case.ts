import {
  DomainError,
  WorkspaceId,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock, IdGenerator } from "../../ledger/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import {
  extensionForMime,
  validateVoiceUpload,
} from "../domain/voice-upload.js";
import type { FileHasherPort } from "./ports/file-hasher.port.js";
import type { VoiceFileHashPort } from "./ports/voice-file-hash.port.js";
import type { VoiceDraftDispatcher } from "./ports/voice-draft-dispatcher.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import type { VoiceStoragePort } from "./ports/voice-storage.port.js";
import { toVoiceNoteView, type VoiceNoteView } from "./voice-note.view.js";

export interface UploadVoiceNoteCommand {
  readonly workspaceId: WorkspaceId;
  readonly uploaderSubject: string;
  readonly originalFilename: string;
  readonly bytes: Uint8Array;
}

export interface VoiceUploadPolicy {
  /** VOICE_MAX_BYTES — quarantine size cap (default 5 MiB, S1). */
  readonly maxBytes: number;
}

const FILENAME_MAX_LENGTH = 255;
const FALLBACK_FILENAME = "voice-note";

/**
 * Upload + quarantine (voice-drafts T1, S1+S5):
 *   validate (magic bytes + size) → store under a quarantine key →
 *   insert `pending` row → enqueue `voice-draft` (payload {voiceNoteId}).
 *
 * Validation runs BEFORE storage: a rejected upload leaves no object and
 * no row. A dispatch failure is logged but does not fail the request —
 * the pending row remains the recoverable source of truth.
 */
export class UploadVoiceNoteUseCase {
  constructor(
    private readonly storage: VoiceStoragePort,
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly fileHashes: VoiceFileHashPort,
    private readonly hasher: FileHasherPort,
    private readonly dispatcher: VoiceDraftDispatcher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly policy: VoiceUploadPolicy,
  ) {}

  async execute(
    command: UploadVoiceNoteCommand,
  ): Promise<Result<VoiceNoteView, DomainError>> {
    const valid = validateVoiceUpload({
      bytes: command.bytes,
      maxBytes: this.policy.maxBytes,
    });
    if (!valid.ok) {
      return valid;
    }

    // S5: exact-hash dedup — the SAME bytes already uploaded in this
    // workspace return the existing note unchanged (idempotent: no
    // second file, row or job). A `failed` note is returned as-is too —
    // retry owns the re-enqueue.
    const fileHash = this.hasher.sha256Hex(command.bytes);
    const existing = await this.fileHashes.findByFileHash(
      command.workspaceId,
      fileHash,
    );
    if (existing) {
      // Returning a terminal note would make the same bytes
      // unprocessable forever. `rejected` is user-discard — reuse the
      // row: back to pending + re-enqueue over the original storageKey
      // (a dispatch failure marks the note failed so it never sticks
      // pending). `confirmed` stays returned as-is — the draft already
      // materialized a transaction, that IS the dedup.
      if (existing.status === "rejected") {
        // S7: the stored object was early-deleted or purged — re-store
        // the SAME bytes under the ORIGINAL storageKey and clear the
        // marker so the re-enqueued draft job finds it. The cheap dedup
        // path (media still present) never touches storage.
        if (existing.mediaDeletedAt !== null) {
          await this.storage.save(
            existing.storageKey,
            command.bytes,
            existing.mimeType,
          );
          existing.restoreMedia(this.clock.now());
        }
        existing.resetToPending(this.clock.now());
        await this.notes.save(existing);
        try {
          await this.dispatcher.enqueueDraft(
            existing.id,
            command.workspaceId.value,
          );
        } catch (cause) {
          console.error(
            `[voices] failed to re-enqueue voice-draft job for ${existing.id}:`,
            cause,
          );
          existing.markFailed(
            "voice-draft dispatch failed",
            this.clock.now(),
          );
          await this.notes.save(existing);
        }
      }
      return ok(toVoiceNoteView(existing));
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
    const note = VoiceNote.quarantine({
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
    if (!note.ok) {
      return note;
    }
    try {
      await this.notes.save(note.value);
    } catch (cause) {
      // S5: a concurrent identical upload can race past the lookup
      // above and hit UNIQUE(workspaceId, fileHash) on insert.
      // Best-effort: re-read the winner and return it — the response is
      // identical to the serialized dedup path. Any other insert
      // failure propagates unchanged.
      const winner = await this.fileHashes
        .findByFileHash(command.workspaceId, fileHash)
        .catch(() => null);
      if (winner) {
        return ok(toVoiceNoteView(winner));
      }
      throw cause;
    }

    try {
      await this.dispatcher.enqueueDraft(id, command.workspaceId.value);
    } catch (cause) {
      console.error(
        `[voices] failed to enqueue voice-draft job for ${id}:`,
        cause,
      );
    }

    return ok(toVoiceNoteView(note.value));
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
