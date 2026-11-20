import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { toVoiceNoteView, type VoiceNoteView } from "./voice-note.view.js";

/** Polling read for `GET /api/v1/voices/:id` (voice-drafts T1). */
export class GetVoiceNoteUseCase {
  constructor(private readonly notes: VoiceNoteRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Result<VoiceNoteView, DomainError>> {
    const note = await this.notes.findById(workspaceId, id);
    if (!note) {
      return err(
        new DomainError("VOICE_NOT_FOUND", `Voice note not found: ${id}`),
      );
    }
    return ok(toVoiceNoteView(note));
  }
}
