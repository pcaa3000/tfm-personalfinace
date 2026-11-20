import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * The workspace preferences the draft pipeline needs (voice-drafts T2,
 * S3): `timezone` resolves the business date and the model's relative
 * `dateHint`; `defaultCurrency` fills in when the dictation named no
 * currency. Narrower than `WorkspaceContext` — a background job has no
 * caller identity, so it reads by workspace id.
 */
export interface VoiceWorkspaceContext {
  readonly timezone: string;
  readonly defaultCurrency: string;
}

/** Read port: the workspace preferences of a known workspace. */
export interface VoiceWorkspaceContextPort {
  /** The workspace's preferences, or null when the workspace is gone. */
  findContext(workspaceId: WorkspaceId): Promise<VoiceWorkspaceContext | null>;
}

export const VOICE_WORKSPACE_CONTEXT = Symbol("VOICE_WORKSPACE_CONTEXT");
