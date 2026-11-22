import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { VoiceConsent } from "../../domain/voice-consent.js";

/**
 * Persistence port for `voices_voice_consents` (voice-drafts T5, S6):
 * one row per (workspace, subject, provider) — {@link saveConsent}
 * upserts on that key so grant → revoke → re-grant all update the
 * SAME record and its instants instead of accumulating rows.
 */
export interface VoiceConsentRepositoryPort {
  findConsent(
    workspaceId: WorkspaceId,
    subject: string,
    provider: string,
  ): Promise<VoiceConsent | null>;
  saveConsent(consent: VoiceConsent): Promise<void>;
}

export const VOICE_CONSENT_REPOSITORY = Symbol("VOICE_CONSENT_REPOSITORY");
