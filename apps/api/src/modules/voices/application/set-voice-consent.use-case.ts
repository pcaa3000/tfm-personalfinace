import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock, IdGenerator } from "../../ledger/index.js";
import { VOICE_LLM_PROVIDER, VoiceConsent } from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import {
  toVoiceConsentView,
  type VoiceConsentView,
} from "./voice-consent.view.js";

export interface SetVoiceConsentInput {
  readonly granted: boolean;
}

/**
 * `PATCH /api/v1/voices/consent` (voice-drafts T5, S6 — docs/05):
 * registers the caller's grant or revocation for the voice LLM
 * provider. Upserts the single (workspace, subject, provider) row —
 * a revoke stamps `revokedAt` and keeps the record; a re-grant stamps
 * a fresh `grantedAt` without erasing the earlier revoke.
 */
export class SetVoiceConsentUseCase {
  constructor(
    private readonly consents: VoiceConsentRepositoryPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    workspaceId: WorkspaceId,
    subject: string,
    input: SetVoiceConsentInput,
  ): Promise<VoiceConsentView> {
    const now = this.clock.now();
    const consent =
      (await this.consents.findConsent(
        workspaceId,
        subject,
        VOICE_LLM_PROVIDER,
      )) ??
      VoiceConsent.create({
        id: this.ids.next(),
        workspaceId,
        subject,
        provider: VOICE_LLM_PROVIDER,
        now,
      });

    if (input.granted) {
      consent.grant(now);
    } else {
      consent.revoke(now);
    }
    await this.consents.saveConsent(consent);
    return toVoiceConsentView(consent);
  }
}
