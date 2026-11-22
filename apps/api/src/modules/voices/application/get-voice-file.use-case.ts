import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import type { VoiceStoragePort } from "./ports/voice-storage.port.js";

export interface VoiceFileView {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly originalFilename: string;
}

/**
 * Streams a stored voice note through the API (T1: acceptable until
 * signed URLs land). Row lookup is workspace-scoped, so a note — and
 * its bytes — are never served across workspaces.
 */
export class GetVoiceFileUseCase {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly storage: VoiceStoragePort,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<VoiceFileView, DomainError>> {
    const note = await this.notes.findById(workspaceId, id);
    if (!note) {
      return err(
        new DomainError("VOICE_NOT_FOUND", `Voice note not found: ${id}`),
      );
    }
    // S7: media deleted early or purged — a distinct code mapped to 410
    // so clients tell "media gone" apart from "note not found" (404).
    // Storage drift (object absent without a marker) reads the same
    // way: the medium is gone either way.
    if (note.mediaDeletedAt !== null) {
      return err(
        new DomainError(
          "VOICE_MEDIA_DELETED",
          `Media deleted for voice note: ${id}`,
        ),
      );
    }
    const bytes = await this.storage.open(note.storageKey);
    if (bytes === null) {
      return err(
        new DomainError(
          "VOICE_MEDIA_DELETED",
          `Stored object missing for voice note: ${id}`,
        ),
      );
    }
    return ok({
      bytes,
      mimeType: note.mimeType,
      originalFilename: note.originalFilename,
    });
  }
}
