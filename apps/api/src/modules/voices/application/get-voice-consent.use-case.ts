import type { WorkspaceId } from "../../shared-kernel/index.js";
import { VOICE_LLM_PROVIDER } from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "./ports/voice-consent-repository.port.js";
import {
  toVoiceConsentView,
  type VoiceConsentView,
} from "./voice-consent.view.js";

/**
 * `GET /api/v1/voices/consent` (voice-drafts T5, S6): reads the
 * (workspace, subject, provider) decision for the authenticated
 * caller — the client consults it before the first audio send.
 */
export class GetVoiceConsentUseCase {
  constructor(private readonly consents: VoiceConsentRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    subject: string,
  ): Promise<VoiceConsentView> {
    const consent = await this.consents.findConsent(
      workspaceId,
      subject,
      VOICE_LLM_PROVIDER,
    );
    return toVoiceConsentView(consent);
  }
}
