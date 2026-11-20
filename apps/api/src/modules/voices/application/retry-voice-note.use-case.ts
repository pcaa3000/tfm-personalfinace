import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import type { VoiceDraftDispatcher } from "./ports/voice-draft-dispatcher.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { toVoiceNoteView, type VoiceNoteView } from "./voice-note.view.js";

/**
 * Retry without re-upload for `POST /api/v1/voices/:id/retry`
 * (voice-drafts T3, S5):
 *   failed               → back to `pending` (error cleared) + the same
 *                          draft job is re-enqueued over the original
 *                          storageKey — the audio is never re-uploaded.
 *   pending / draft_ready → idempotent no-op: the job is still in
 *                          flight or the draft is reviewable, so no
 *                          re-enqueue is needed.
 *   confirmed / rejected → VOICE_ALREADY_FINAL (409): user-final.
 *   missing / foreign    → VOICE_NOT_FOUND (404).
 */
export class RetryVoiceNoteUseCase {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly dispatcher: VoiceDraftDispatcher,
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
    if (note.status === "confirmed" || note.status === "rejected") {
      return err(
        new DomainError(
          "VOICE_ALREADY_FINAL",
          `Voice note ${id} is already ${note.status} and cannot be retried`,
        ),
      );
    }
    if (note.status === "failed") {
      note.resetToPending(this.clock.now());
      await this.notes.save(note);
      // Same convention as upload: a dispatch failure is logged but the
      // pending row remains the recoverable source of truth.
      try {
        await this.dispatcher.enqueueDraft(note.id, note.workspaceId.value);
      } catch (cause) {
        console.error(
          `[voices] failed to re-enqueue voice-draft job for ${note.id}:`,
          cause,
        );
        // R4-RETRY-LOST-JOB (same fix receipts applies): a pending row
        // without a job is a dead end — retry treats `pending` as a
        // no-op and upload dedup returns it unchanged, so nothing would
        // ever re-enqueue. Mark the note `failed` instead so the retry
        // endpoint stays reachable.
        note.markFailed(
          "voice-draft dispatch failed",
          this.clock.now(),
        );
        await this.notes.save(note);
      }
    }
    return ok(toVoiceNoteView(note));
  }
}
