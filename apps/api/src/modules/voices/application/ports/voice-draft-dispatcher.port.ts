/**
 * Async pipeline trigger (voice-drafts S5): after quarantine the note
 * is dispatched to the `voice-draft` pg-boss queue (or run inline on
 * the single-component deploy — VOICE_DISPATCHER), where T2 attaches
 * the LLM draft handler. The payload stays minimal — the row is the
 * source of truth.
 */
export interface VoiceDraftDispatcher {
  /**
   * Job payload {voiceNoteId, workspaceId} mirrors the receipts
   * scan job — the workspace scope lets the worker resolve the row
   * through the workspace-scoped repository port.
   */
  enqueueDraft(voiceNoteId: string, workspaceId: string): Promise<void>;
}

export const VOICE_DRAFT_DISPATCHER = Symbol("VOICE_DRAFT_DISPATCHER");

/** Queue name shared with the worker (jobs live under src/jobs + worker.ts). */
export const VOICE_DRAFT_QUEUE = "voice-draft";
