import { getVoiceDraft, getVoiceNote, uploadVoiceNote } from "./api";
import type { VoiceDraftPayload, VoiceNoteView } from "./voice-draft";

/**
 * Voice capture → poll → draft orchestration (voice-drafts T4, S1+S2).
 * The API is async: `POST /voices` returns a `pending` note and a
 * worker transcribes + extracts; the web polls `GET /voices/:id`
 * until `draft_ready`, then loads `GET /voices/:id/draft`.
 *
 * Same S11 retry pattern as receipt-scan-flow: polling is split from
 * upload so a retry NEVER re-uploads the audio — a poll timeout
 * resumes `awaitVoiceDraft` over the same note, and a `failed` note
 * first calls `POST /voices/:id/retry` to reset it server-side.
 */

/** The pipeline reported a dead-end terminal status for the note. */
export class VoiceNoteFailedError extends Error {
  readonly noteError: string | null;
  readonly noteId: string;

  constructor(noteError: string | null, noteId: string) {
    super(noteError ?? "Voice note processing failed");
    this.name = "VoiceNoteFailedError";
    this.noteError = noteError;
    this.noteId = noteId;
  }
}

/** The note stayed non-terminal beyond the polling budget. */
export class VoicePollTimeoutError extends Error {
  readonly noteId: string;

  constructor(noteId: string) {
    super("Voice note polling timed out");
    this.name = "VoicePollTimeoutError";
    this.noteId = noteId;
  }
}

export type VoiceFlowPhase = "uploading" | "analyzing";

/** Polling options shared by uploadAndAwaitVoiceDraft and awaitVoiceDraft. */
export interface AwaitVoiceDraftOptions {
  /** Poll cadence — defaults to ~2s. */
  pollIntervalMs?: number;
  /** Overall polling budget — defaults to ~60s. */
  timeoutMs?: number;
  onPhase?: (phase: VoiceFlowPhase) => void;
  /** Latest note observed (upload response + every poll) — lets the
   * caller keep the noteId needed to retry without re-uploading. */
  onNote?: (note: VoiceNoteView) => void;
  getNote?: (id: string) => Promise<VoiceNoteView>;
  getDraft?: (id: string) => Promise<VoiceDraftPayload>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface UploadAndAwaitVoiceDraftOptions
  extends AwaitVoiceDraftOptions {
  upload?: (file: File) => Promise<VoiceNoteView>;
}

/** Terminal statuses where polling stops without a draft. */
const DEAD_END_STATUSES = new Set(["failed", "confirmed", "rejected"]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls an existing note until the draft is ready (S11 pattern). The
 * caller passes the latest note view it has — the upload response or
 * the retry endpoint's reset row — and polling continues over the same
 * note id. Timeout and failure errors carry `noteId` so a retry can
 * resume without the view.
 */
export async function awaitVoiceDraft(
  initialNote: VoiceNoteView,
  options: AwaitVoiceDraftOptions = {},
): Promise<{ note: VoiceNoteView; draft: VoiceDraftPayload }> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const getNote = options.getNote ?? getVoiceNote;
  const getDraft = options.getDraft ?? getVoiceDraft;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  options.onPhase?.("analyzing");
  const deadline = now() + timeoutMs;
  let note = initialNote;
  options.onNote?.(note);
  while (note.status !== "draft_ready") {
    if (DEAD_END_STATUSES.has(note.status)) {
      throw new VoiceNoteFailedError(note.error, note.id);
    }
    if (now() >= deadline) {
      throw new VoicePollTimeoutError(note.id);
    }
    await sleep(pollIntervalMs);
    note = await getNote(note.id);
    options.onNote?.(note);
  }

  const draft = await getDraft(note.id);
  return { note, draft };
}

/**
 * Uploads the audio and polls until the draft is ready. Network
 * failures (TypeError) propagate untouched so the UI can show the
 * "voice notes require connection" message — upload is online-only
 * (S8: the offline binary queue is a separate post-MVP feature).
 */
export async function uploadAndAwaitVoiceDraft(
  file: File,
  options: UploadAndAwaitVoiceDraftOptions = {},
): Promise<{ note: VoiceNoteView; draft: VoiceDraftPayload }> {
  const upload = options.upload ?? uploadVoiceNote;

  options.onPhase?.("uploading");
  const note = await upload(file);
  return awaitVoiceDraft(note, options);
}
