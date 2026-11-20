import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { VoiceNote } from "../../domain/voice-note.js";
import type { VoiceNoteCursor } from "../voice-note-cursor.js";

/** Persistence port for the `voices_voice_notes` rows. */
export interface VoiceNoteRepositoryPort {
  save(note: VoiceNote): Promise<void>;
  /** Workspace-scoped lookup — a note is never visible across workspaces. */
  findById(workspaceId: WorkspaceId, id: string): Promise<VoiceNote | null>;
}

export const VOICE_NOTE_REPOSITORY = Symbol("VOICE_NOTE_REPOSITORY");

/**
 * Keyset page request for the workspace list: `limit` rows strictly
 * after the exclusive `after` position in `createdAt DESC, id DESC`
 * order.
 */
export interface VoiceNoteListQuery {
  /** Page size — the HTTP edge already enforces 1..100. */
  readonly limit: number;
  /** Exclusive keyset position; absent → first (newest) page. */
  readonly after?: VoiceNoteCursor;
}

export interface VoiceNoteListSlice {
  readonly notes: VoiceNote[];
  /** True when further rows exist beyond this slice. */
  readonly hasMore: boolean;
}

/**
 * Workspace-scoped list read. Split from
 * {@link VoiceNoteRepositoryPort} so consumers that only enumerate
 * notes depend on a narrow port — the same separation the receipts
 * module applies to its scan list.
 */
export interface VoiceNoteListPort {
  /**
   * Up to `query.limit` notes of the workspace, newest first
   * (`createdAt DESC, id DESC`), strictly after `query.after` when set
   * (keyset/seek — stable under concurrent inserts). Notes whose media
   * was deleted (`mediaDeletedAt IS NOT NULL`) are excluded at query
   * level — a row without its audio adds nothing to the list (the
   * confirmed transaction is untouched, same rule as receipts, S7).
   */
  listByWorkspace(
    workspaceId: WorkspaceId,
    query: VoiceNoteListQuery,
  ): Promise<VoiceNoteListSlice>;
}
