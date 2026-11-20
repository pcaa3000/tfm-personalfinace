import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { toVoiceNoteView, type VoiceNoteView } from "./voice-note.view.js";

/**
 * User discard for `POST /api/v1/voices/:id/reject` (voice-drafts T3,
 * S5): any non-terminal note (pending quarantine, reviewable draft)
 * moves to `rejected`; terminal states (confirmed/rejected/failed)
 * conflict.
 */
export class RejectVoiceNoteUseCase {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly clock: Clock,
  ) {}

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
    if (note.isTerminal) {
      return err(
        new DomainError(
          "VOICE_ALREADY_FINAL",
          `Voice note ${id} is already ${note.status} and cannot be rejected`,
        ),
      );
    }
    note.markRejected(this.clock.now());
    await this.notes.save(note);
    return ok(toVoiceNoteView(note));
  }
}
