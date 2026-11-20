import { WorkspaceId } from "../../shared-kernel/index.js";

/**
 * The LLM provider the consent covers (voice-drafts T5, S6 — docs/05
 * RF-070 records the provider per acceptance). A provider switch
 * re-prompts the dialog because the row is keyed by this value.
 */
export const VOICE_LLM_PROVIDER = "gemini";

/** Full persisted state used by infrastructure to rebuild the entity. */
export interface VoiceConsentState {
  readonly id: string;
  readonly workspaceId: string;
  readonly subject: string;
  readonly provider: string;
  readonly grantedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateVoiceConsentInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly subject: string;
  readonly provider: string;
  readonly now: Date;
}

/**
 * Provider-consent record (S6 — docs/05 "Consentimiento informado" +
 * "Revocación"): ONE row per (workspace, subject, provider) keeps the
 * latest decision with BOTH instants — the record is audit data
 * (retention: vida de la cuenta) and is never deleted on revoke.
 * `active` is true only while the latest decision is a grant.
 */
export class VoiceConsent {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly subject: string,
    readonly provider: string,
    private _grantedAt: Date | null,
    private _revokedAt: Date | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  get grantedAt(): Date | null {
    return this._grantedAt;
  }

  get revokedAt(): Date | null {
    return this._revokedAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** True while the most recent decision is a grant. */
  get active(): boolean {
    return (
      this._grantedAt !== null &&
      (this._revokedAt === null || this._grantedAt > this._revokedAt)
    );
  }

  /** docs/05: the acceptance instant is registered — never cleared by a later revoke. */
  grant(now: Date): void {
    this._grantedAt = now;
    this._updatedAt = now;
  }

  /** docs/05 revocation: the record survives; only the instant is stamped. */
  revoke(now: Date): void {
    this._revokedAt = now;
    this._updatedAt = now;
  }

  /** A fresh, undecided record — the first grant/revoke stamps it. */
  static create(input: CreateVoiceConsentInput): VoiceConsent {
    return new VoiceConsent(
      input.id,
      input.workspaceId,
      input.subject,
      input.provider,
      null,
      null,
      input.now,
      input.now,
    );
  }

  /** Rebuilds the entity from persisted state without re-deciding. */
  static reconstitute(state: VoiceConsentState): VoiceConsent {
    const workspaceId = WorkspaceId.create(state.workspaceId);
    if (!workspaceId.ok) {
      throw workspaceId.error;
    }
    return new VoiceConsent(
      state.id,
      workspaceId.value,
      state.subject,
      state.provider,
      state.grantedAt,
      state.revokedAt,
      state.createdAt,
      state.updatedAt,
    );
  }
}
