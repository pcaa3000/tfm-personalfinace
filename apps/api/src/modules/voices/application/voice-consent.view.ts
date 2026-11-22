import { VOICE_LLM_PROVIDER, type VoiceConsent } from "../domain/voice-consent.js";

/** API projection of the caller's provider-consent decision (S6). */
export interface VoiceConsentView {
  readonly provider: string;
  readonly granted: boolean;
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
}

/**
 * A missing record projects as undecided — `granted:false` with no
 * instants — so the client always gates the first send (RF-070).
 */
export function toVoiceConsentView(
  consent: VoiceConsent | null,
): VoiceConsentView {
  return {
    provider: VOICE_LLM_PROVIDER,
    granted: consent?.active ?? false,
    grantedAt: consent?.grantedAt?.toISOString() ?? null,
    revokedAt: consent?.revokedAt?.toISOString() ?? null,
  };
}
