import { and, eq } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { voiceConsents } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VoiceConsent,
  type VoiceConsentState,
} from "../domain/voice-consent.js";
import type { VoiceConsentRepositoryPort } from "../application/ports/voice-consent-repository.port.js";

type Row = typeof voiceConsents.$inferSelect;

function toState(row: Row): VoiceConsentState {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    subject: row.subject,
    provider: row.provider,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Drizzle adapter over `voices_voice_consents` (voice-drafts T5, S6):
 * upsert keyed by UNIQUE(workspaceId, subject, provider) — every
 * decision updates the SAME row, so the consent record is a single
 * evolving flag per caller, never a delete.
 */
export class DrizzleVoiceConsentRepository
  implements VoiceConsentRepositoryPort
{
  constructor(private readonly db: DrizzleDb) {}

  async findConsent(
    workspaceId: WorkspaceId,
    subject: string,
    provider: string,
  ): Promise<VoiceConsent | null> {
    const [row] = await this.db
      .select()
      .from(voiceConsents)
      .where(
        and(
          eq(voiceConsents.workspaceId, workspaceId.value),
          eq(voiceConsents.subject, subject),
          eq(voiceConsents.provider, provider),
        ),
      )
      .limit(1);
    return row ? VoiceConsent.reconstitute(toState(row)) : null;
  }

  async saveConsent(consent: VoiceConsent): Promise<void> {
    await this.db
      .insert(voiceConsents)
      .values({
        id: consent.id,
        workspaceId: consent.workspaceId.value,
        subject: consent.subject,
        provider: consent.provider,
        grantedAt: consent.grantedAt,
        revokedAt: consent.revokedAt,
        createdAt: consent.createdAt,
        updatedAt: consent.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          voiceConsents.workspaceId,
          voiceConsents.subject,
          voiceConsents.provider,
        ],
        set: {
          // The latest decision wins; both instants are kept so the
          // record shows grant → revoke → re-grant history.
          grantedAt: consent.grantedAt,
          revokedAt: consent.revokedAt,
          updatedAt: consent.updatedAt,
        },
      });
  }
}
