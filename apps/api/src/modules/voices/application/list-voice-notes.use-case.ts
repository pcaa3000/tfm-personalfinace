import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  VoiceNoteListPort,
  VoiceNoteListQuery,
} from "./ports/voice-note-repository.port.js";
import { encodeVoiceNoteCursor } from "./voice-note-cursor.js";
import {
  toVoiceNoteListItem,
  type VoiceNoteListItem,
} from "./voice-note.view.js";

/**
 * One page of `GET /api/v1/voices` (voice-drafts T1): `nextCursor` is
 * the opaque keyset token for the next page — null when this slice
 * reaches the end.
 */
export interface VoiceNoteListPage {
  readonly items: VoiceNoteListItem[];
  readonly nextCursor: string | null;
}

/**
 * Workspace voice-note list: every note in any state, newest first;
 * `transactionId` is null until the note is confirmed. Cursor
 * pagination — `query.limit` per page, `query.after` the decoded
 * keyset position of the previous page's last item.
 */
export class ListVoiceNotesUseCase {
  constructor(private readonly notes: VoiceNoteListPort) {}

  async execute(
    workspaceId: WorkspaceId,
    query: VoiceNoteListQuery,
  ): Promise<VoiceNoteListPage> {
    const slice = await this.notes.listByWorkspace(workspaceId, query);
    const items = slice.notes.map(toVoiceNoteListItem);
    const last = slice.notes.at(-1);
    const nextCursor =
      slice.hasMore && last
        ? encodeVoiceNoteCursor({
            createdAt: last.createdAt,
            id: last.id,
          })
        : null;
    return { items, nextCursor };
  }
}
