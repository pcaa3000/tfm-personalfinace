import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import { VOICE_LLM_PROVIDER } from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";

/**
 * docs/05 revocation gate (voice-drafts T5, S6): "Detiene nuevos
 * envíos inmediatamente" — a PENDING note must never reach the
 * provider once its uploader revoked consent. The gate runs at
 * dispatch (ConsentGatedVoiceDraftDispatcher) and again at execution
 * for the inline runner, so a revoke between enqueue and processing
 * still stops the send. The note goes `failed` with
 * VOICE_CONSENT_REVOKED so the UI explains the stop and a retry after
 * re-consent recovers it.
 *
 * A MISSING record does NOT block: first-send consent is the explicit
 * client gate (RF-070) — the server honors the documented client-gate
 * model and only enforces the revocation signal it owns.
 */
export class VoiceDraftConsentGuard {
  constructor(
    private readonly notes: VoiceNoteRepositoryPort,
    private readonly consents: VoiceConsentRepositoryPort,
    private readonly clock: Clock,
  ) {}

  /**
   * True when the note may still be sent to the provider. Revoked →
   * the note is failed and false is returned so the caller skips the
   * dispatch entirely.
   */
  async ensureDispatchable(
    voiceNoteId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const ws = WorkspaceId.create(workspaceId);
    if (!ws.ok) {
      return true; // the job's own validation reports invalid ids
    }
    const note = await this.notes.findById(ws.value, voiceNoteId);
    if (!note || note.status !== "pending") {
      return true; // nothing pending → nothing can be sent
    }
    const consent = await this.consents.findConsent(
      ws.value,
      note.uploaderSubject,
      VOICE_LLM_PROVIDER,
    );
    if (!consent || consent.active) {
      return true;
    }
    note.markFailed(
      "VOICE_CONSENT_REVOKED: the uploader revoked voice processing consent",
      this.clock.now(),
    );
    await this.notes.save(note);
    return false;
  }
}
