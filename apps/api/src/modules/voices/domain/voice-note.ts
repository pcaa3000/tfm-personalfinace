import {
  DomainError,
  WorkspaceId,
  err,
  ok,
  type Result,
} from "../../shared-kernel/index.js";

/**
 * A voice-note audio in the draft pipeline (voice-drafts, S5):
 * `pending` quarantine → `draft_ready` → `confirmed`;
 * `rejected` (user discard) and `failed` (pipeline error) are terminal.
 * T1 only creates `pending` rows; draft_ready arrives with T2's LLM job.
 */
export const VOICE_NOTE_STATUSES = [
  "pending",
  "draft_ready",
  "confirmed",
  "rejected",
  "failed",
] as const;

export type VoiceNoteStatus = (typeof VOICE_NOTE_STATUSES)[number];

/**
 * Fixed media retention (S7, mirroring receipt-retention-30d): 30 days
 * from capture — a domain constant, deliberately not a configuration
 * knob (RF-071: fixed and not configurable above 30 days). Audio AND
 * its transcript share this retention.
 */
export const VOICE_MEDIA_RETENTION_DAYS = 30;
const RETENTION_MS = VOICE_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** States the note never leaves: user-confirmed, user-rejected, pipeline-dead. */
export const VOICE_TERMINAL_STATUSES: readonly VoiceNoteStatus[] = [
  "confirmed",
  "rejected",
  "failed",
];

export interface QuarantineVoiceNoteInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly uploaderSubject: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** SHA-256 hex of the stored bytes — exact-hash dedup (S5). */
  readonly fileHash: string;
  readonly now: Date;
}

/** Full persisted state used by infrastructure to rebuild the entity. */
export interface VoiceNoteState {
  readonly id: string;
  readonly workspaceId: string;
  readonly uploaderSubject: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: VoiceNoteStatus;
  readonly extractedPayload: unknown | null;
  readonly draftPayload: unknown | null;
  readonly transactionId: string | null;
  readonly fileHash?: string | null;
  /** S7: the LLM transcript — persisted with the same sensitivity as the audio. */
  readonly transcript: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Fixed media expiry (S7): `createdAt + 30 days`, persisted. */
  readonly expiresAt: Date;
  /** Set when the stored object was deleted early or purged (S7). */
  readonly mediaDeletedAt: Date | null;
}

const FILENAME_MAX_LENGTH = 255;

function nonEmpty(
  value: string,
  field: string,
): Result<string, DomainError> {
  if (value.trim().length === 0) {
    return err(
      new DomainError("VOICE_NOTE_INVALID", `${field} must not be empty`),
    );
  }
  return ok(value);
}

export class VoiceNote {
  private constructor(
    readonly id: string,
    readonly workspaceId: WorkspaceId,
    readonly uploaderSubject: string,
    readonly storageKey: string,
    readonly originalFilename: string,
    readonly mimeType: string,
    readonly sizeBytes: number,
    readonly fileHash: string | null,
    private _status: VoiceNoteStatus,
    private _extractedPayload: unknown | null,
    private _draftPayload: unknown | null,
    private _transactionId: string | null,
    private _transcript: string | null,
    private _error: string | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
    readonly expiresAt: Date,
    private _mediaDeletedAt: Date | null,
  ) {}

  get status(): VoiceNoteStatus {
    return this._status;
  }

  get extractedPayload(): unknown | null {
    return this._extractedPayload;
  }

  get transactionId(): string | null {
    return this._transactionId;
  }

  /** true once the note reached a state it never leaves. */
  get isTerminal(): boolean {
    return VOICE_TERMINAL_STATUSES.includes(this._status);
  }

  get draftPayload(): unknown | null {
    return this._draftPayload;
  }

  get transcript(): string | null {
    return this._transcript;
  }

  get error(): string | null {
    return this._error;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get mediaDeletedAt(): Date | null {
    return this._mediaDeletedAt;
  }

  /**
   * A freshly quarantined upload: validated bytes already stored under
   * `storageKey`; the row starts `pending` until the draft pipeline (T2)
   * extracts it.
   */
  static quarantine(
    input: QuarantineVoiceNoteInput,
  ): Result<VoiceNote, DomainError> {
    for (const [value, field] of [
      [input.id, "id"],
      [input.uploaderSubject, "uploaderSubject"],
      [input.storageKey, "storageKey"],
      [input.mimeType, "mimeType"],
      [input.fileHash, "fileHash"],
    ] as const) {
      const check = nonEmpty(value, field);
      if (!check.ok) return check;
    }
    const filename = input.originalFilename.trim();
    if (filename.length === 0) {
      return err(
        new DomainError(
          "VOICE_NOTE_INVALID",
          "originalFilename must not be empty",
        ),
      );
    }
    if (filename.length > FILENAME_MAX_LENGTH) {
      return err(
        new DomainError(
          "VOICE_NOTE_INVALID",
          `originalFilename exceeds ${FILENAME_MAX_LENGTH} characters`,
        ),
      );
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      return err(
        new DomainError(
          "VOICE_NOTE_INVALID",
          "sizeBytes must be a positive integer",
        ),
      );
    }
    return ok(
      new VoiceNote(
        input.id,
        input.workspaceId,
        input.uploaderSubject,
        input.storageKey,
        filename,
        input.mimeType,
        input.sizeBytes,
        input.fileHash,
        "pending",
        null,
        null,
        null,
        null,
        null,
        input.now,
        input.now,
        // S7: media expiry stamped at capture — createdAt + 30 days.
        new Date(input.now.getTime() + RETENTION_MS),
        null,
      ),
    );
  }

  /**
   * The stored object is gone — early user deletion or the scheduled
   * purge — while the note row and its confirmed transaction survive
   * untouched (same retention mechanics as receipts, S7).
   */
  markMediaDeleted(now: Date): void {
    this._mediaDeletedAt = now;
    this._updatedAt = now;
  }

  /**
   * Dedup re-upload after early delete/purge (S7): the SAME bytes were
   * re-stored under the original `storageKey`, so the deletion marker
   * clears and the re-draft finds the object. The ONLY path that
   * un-sets `mediaDeletedAt`.
   */
  restoreMedia(now: Date): void {
    this._mediaDeletedAt = null;
    this._updatedAt = now;
  }

  /**
   * T2 (S2+S7): transcription and the categorized draft arrive from a
   * single LLM call, so the row goes pending → draft_ready in one
   * transition, carrying the raw extraction (evidence), the grouped
   * draft the user reviews, and the persisted transcript.
   */
  markDraftReady(
    extractedPayload: unknown,
    draftPayload: unknown,
    transcript: string,
    now: Date,
  ): void {
    this._extractedPayload = extractedPayload;
    this._draftPayload = draftPayload;
    this._transcript = transcript;
    this._error = null;
    this._status = "draft_ready";
    this._updatedAt = now;
  }

  /** Terminal pipeline failure — `error` is surfaced on the polling view. */
  markFailed(message: string, now: Date): void {
    this._status = "failed";
    this._error = message.slice(0, 500);
    this._updatedAt = now;
  }

  /**
   * T3: the user approved the draft — links the recorded transaction.
   * Callers must gate on `status === "draft_ready"`; replay detection
   * compares the stored key before re-confirming.
   */
  markConfirmed(transactionId: string, now: Date): void {
    this._status = "confirmed";
    this._transactionId = transactionId;
    this._updatedAt = now;
  }

  /**
   * A terminal `failed` note returns to `pending` so the re-enqueued
   * job re-runs the pipeline over the ORIGINAL storageKey — the audio
   * is never re-uploaded. Callers gate on `status === "failed"`.
   */
  resetToPending(now: Date): void {
    this._status = "pending";
    this._error = null;
    this._updatedAt = now;
  }

  /** The user discards the note; allowed only from non-terminal states. */
  markRejected(now: Date): void {
    this._status = "rejected";
    this._updatedAt = now;
  }

  /** Rebuilds the entity from persisted state without re-validating. */
  static reconstitute(state: VoiceNoteState): VoiceNote {
    const workspaceId = WorkspaceId.create(state.workspaceId);
    if (!workspaceId.ok) {
      throw workspaceId.error;
    }
    return new VoiceNote(
      state.id,
      workspaceId.value,
      state.uploaderSubject,
      state.storageKey,
      state.originalFilename,
      state.mimeType,
      state.sizeBytes,
      state.fileHash ?? null,
      state.status,
      state.extractedPayload,
      state.draftPayload,
      state.transactionId,
      state.transcript,
      state.error,
      state.createdAt,
      state.updatedAt,
      state.expiresAt,
      state.mediaDeletedAt,
    );
  }
}
