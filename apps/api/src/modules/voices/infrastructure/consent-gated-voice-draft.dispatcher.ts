import type { VoiceDraftConsentGuard } from "../application/voice-draft-consent-guard.js";
import type { VoiceDraftDispatcher } from "../application/ports/voice-draft-dispatcher.port.js";

/**
 * Dispatch-time revocation gate (voice-drafts T5, S6 — docs/05
 * "Detiene nuevos envíos inmediatamente"): decorates ANY voice-draft
 * dispatcher (pgboss or inline) so an enqueue after revocation never
 * reaches the queue/runner. The guard fails the pending note with
 * VOICE_CONSENT_REVOKED — the poll view surfaces the reason and a
 * retry after re-consent re-enqueues over the same audio.
 */
export class ConsentGatedVoiceDraftDispatcher
  implements VoiceDraftDispatcher
{
  constructor(
    private readonly inner: VoiceDraftDispatcher & {
      close(): Promise<void>;
    },
    private readonly guard: Pick<
      VoiceDraftConsentGuard,
      "ensureDispatchable"
    >,
  ) {}

  async enqueueDraft(
    voiceNoteId: string,
    workspaceId: string,
  ): Promise<void> {
    if (await this.guard.ensureDispatchable(voiceNoteId, workspaceId)) {
      await this.inner.enqueueDraft(voiceNoteId, workspaceId);
    }
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}
