import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { voiceNotes } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VoiceNote,
  type VoiceNoteState,
  type VoiceNoteStatus,
} from "../domain/voice-note.js";
import type { VoiceFileHashPort } from "../application/ports/voice-file-hash.port.js";
import type {
  VoiceNoteListPort,
  VoiceNoteListQuery,
  VoiceNoteListSlice,
  VoiceNoteRepositoryPort,
} from "../application/ports/voice-note-repository.port.js";

type Row = typeof voiceNotes.$inferSelect;

function toState(row: Row): VoiceNoteState {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    uploaderSubject: row.uploaderSubject,
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as VoiceNoteStatus,
    extractedPayload: row.extractedPayload,
    draftPayload: row.draftPayload,
    transcript: row.transcript,
    transactionId: row.transactionId,
    fileHash: row.fileHash,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    mediaDeletedAt: row.mediaDeletedAt,
  };
}

/**
 * Drizzle adapter over `voices_voice_notes` (voice-drafts T1, S5) —
 * also the fileHash dedup index and the workspace list port.
 */
export class DrizzleVoiceNoteRepository
  implements
    VoiceNoteRepositoryPort,
    VoiceNoteListPort,
    VoiceFileHashPort
{
  constructor(private readonly db: DrizzleDb) {}

  async save(note: VoiceNote): Promise<void> {
    await this.db
      .insert(voiceNotes)
      .values({
        id: note.id,
        workspaceId: note.workspaceId.value,
        uploaderSubject: note.uploaderSubject,
        storageKey: note.storageKey,
        originalFilename: note.originalFilename,
        mimeType: note.mimeType,
        sizeBytes: note.sizeBytes,
        status: note.status,
        fileHash: note.fileHash,
        extractedPayload:
          note.extractedPayload === null
            ? null
            : (note.extractedPayload as Record<string, unknown>),
        draftPayload:
          note.draftPayload === null
            ? null
            : (note.draftPayload as Record<string, unknown>),
        transcript: note.transcript,
        transactionId: note.transactionId,
        error: note.error,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        expiresAt: note.expiresAt,
        mediaDeletedAt: note.mediaDeletedAt,
      })
      .onConflictDoUpdate({
        target: voiceNotes.id,
        set: {
          status: note.status,
          extractedPayload:
            note.extractedPayload === null
              ? null
              : (note.extractedPayload as Record<string, unknown>),
          draftPayload:
            note.draftPayload === null
              ? null
              : (note.draftPayload as Record<string, unknown>),
          transcript: note.transcript,
          transactionId: note.transactionId,
          error: note.error,
          updatedAt: note.updatedAt,
          // expiresAt is immutable (fixed at capture) — only the media
          // deletion marker is mutable state on this row.
          mediaDeletedAt: note.mediaDeletedAt,
        },
      });
  }

  async findById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<VoiceNote | null> {
    const [row] = await this.db
      .select()
      .from(voiceNotes)
      .where(
        and(
          eq(voiceNotes.id, id),
          eq(voiceNotes.workspaceId, workspaceId.value),
        ),
      )
      .limit(1);
    return row ? VoiceNote.reconstitute(toState(row)) : null;
  }

  /**
   * Newest-first workspace listing with keyset/seek pagination —
   * `ORDER BY createdAt DESC, id DESC` and an exclusive
   * `(createdAt, id) < cursor` predicate, so a concurrent insert can
   * never shift or repeat a client's page the way OFFSET would.
   * Fetches limit+1 to detect `hasMore`. Media-deleted rows are
   * excluded in the WHERE clause (retention, S7).
   */
  async listByWorkspace(
    workspaceId: WorkspaceId,
    query: VoiceNoteListQuery,
  ): Promise<VoiceNoteListSlice> {
    const conditions = [
      eq(voiceNotes.workspaceId, workspaceId.value),
      isNull(voiceNotes.mediaDeletedAt),
    ];
    if (query.after) {
      const after = query.after;
      const keyset = or(
        lt(voiceNotes.createdAt, after.createdAt),
        and(
          eq(voiceNotes.createdAt, after.createdAt),
          lt(voiceNotes.id, after.id),
        ),
      );
      if (keyset) conditions.push(keyset);
    }
    const rows = await this.db
      .select()
      .from(voiceNotes)
      .where(and(...conditions))
      .orderBy(desc(voiceNotes.createdAt), desc(voiceNotes.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      notes: page.map((row) => VoiceNote.reconstitute(toState(row))),
      hasMore,
    };
  }

  /**
   * S5: exact-hash dedup lookup — UNIQUE(workspaceId, fileHash) backs
   * this; NULL hashes never match.
   */
  async findByFileHash(
    workspaceId: WorkspaceId,
    fileHash: string,
  ): Promise<VoiceNote | null> {
    const [row] = await this.db
      .select()
      .from(voiceNotes)
      .where(
        and(
          eq(voiceNotes.workspaceId, workspaceId.value),
          eq(voiceNotes.fileHash, fileHash),
        ),
      )
      .limit(1);
    return row ? VoiceNote.reconstitute(toState(row)) : null;
  }
}
