import type { VoiceNote } from "../domain/voice-note.js";

/**
 * Read model for the voices API. Deliberately omits `storageKey` —
 * object-store internals never leave the boundary; clients fetch bytes
 * through `GET /api/v1/voices/:id/file`.
 */
export interface VoiceNoteView {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly transactionId: string | null;
  /** S7: the persisted transcript — null until the draft job (T2) lands it. */
  readonly transcript: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** ISO instant the stored medium expires (fixed capture + 30d, S7). */
  readonly expiresAt: string;
  /** ISO instant the medium was deleted — null while it exists (S7). */
  readonly mediaDeletedAt: string | null;
}

/**
 * Trimmed list row for `GET /api/v1/voices`: review state + file
 * identity + the note↔movement link (`transactionId`, null until the
 * note is confirmed).
 */
export interface VoiceNoteListItem {
  readonly id: string;
  readonly status: string;
  readonly originalFilename: string;
  readonly fileMimeType: string;
  readonly createdAt: string;
  readonly transactionId: string | null;
  /** ISO instant the stored medium expires (fixed capture + 30d, S7). */
  readonly expiresAt: string;
  /** ISO instant the medium was deleted — null while it exists (S7). */
  readonly mediaDeletedAt: string | null;
}

export function toVoiceNoteListItem(note: VoiceNote): VoiceNoteListItem {
  return {
    id: note.id,
    status: note.status,
    originalFilename: note.originalFilename,
    fileMimeType: note.mimeType,
    createdAt: note.createdAt.toISOString(),
    transactionId: note.transactionId,
    expiresAt: note.expiresAt.toISOString(),
    mediaDeletedAt: note.mediaDeletedAt?.toISOString() ?? null,
  };
}

export function toVoiceNoteView(note: VoiceNote): VoiceNoteView {
  return {
    id: note.id,
    workspaceId: note.workspaceId.value,
    status: note.status,
    originalFilename: note.originalFilename,
    mimeType: note.mimeType,
    sizeBytes: note.sizeBytes,
    transactionId: note.transactionId,
    transcript: note.transcript,
    error: note.error,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    expiresAt: note.expiresAt.toISOString(),
    mediaDeletedAt: note.mediaDeletedAt?.toISOString() ?? null,
  };
}
