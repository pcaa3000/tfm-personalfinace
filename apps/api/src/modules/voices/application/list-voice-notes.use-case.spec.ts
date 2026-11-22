import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceNoteListPort } from "./ports/voice-note-repository.port.js";
import { decodeVoiceNoteCursor } from "./voice-note-cursor.js";
import { ListVoiceNotesUseCase } from "./list-voice-notes.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeNote(
  id: string,
  createdAt = "2026-11-10T12:00:00.000Z",
): VoiceNote {
  const note = VoiceNote.quarantine({
    id,
    workspaceId: ws,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-1/${id}.webm`,
    originalFilename: `${id}.webm`,
    mimeType: "audio/webm",
    sizeBytes: 100,
    fileHash: id.padEnd(64, "0").slice(0, 64),
    now: new Date(createdAt),
  });
  if (!note.ok) throw note.error;
  return note.value;
}

describe("ListVoiceNotesUseCase (voice-drafts T1, S5)", () => {
  it("returns the page notes as list items carrying the linked transaction id", async () => {
    const confirmed = makeNote("note-confirmed");
    confirmed.markConfirmed("trx-9", new Date("2026-11-10T12:05:00.000Z"));
    const notes: VoiceNoteListPort = {
      listByWorkspace: vi.fn(async () => ({
        notes: [makeNote("note-pending"), confirmed],
        hasMore: false,
      })),
    };
    const useCase = new ListVoiceNotesUseCase(notes);

    const page = await useCase.execute(ws, { limit: 50 });

    expect(vi.mocked(notes.listByWorkspace)).toHaveBeenCalledWith(ws, {
      limit: 50,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: "note-pending",
        status: "pending",
        originalFilename: "note-pending.webm",
        fileMimeType: "audio/webm",
        createdAt: "2026-11-10T12:00:00.000Z",
        transactionId: null,
        expiresAt: "2026-12-10T12:00:00.000Z",
        mediaDeletedAt: null,
      },
      {
        id: "note-confirmed",
        status: "confirmed",
        originalFilename: "note-confirmed.webm",
        fileMimeType: "audio/webm",
        createdAt: "2026-11-10T12:00:00.000Z",
        transactionId: "trx-9",
        expiresAt: "2026-12-10T12:00:00.000Z",
        mediaDeletedAt: null,
      },
    ]);
  });

  it("emits an opaque nextCursor for the last item while the page hasMore", async () => {
    const notes: VoiceNoteListPort = {
      listByWorkspace: vi.fn(async () => ({
        notes: [
          makeNote("note-newer", "2026-11-10T13:00:00.000Z"),
          makeNote("note-older", "2026-11-10T12:00:00.000Z"),
        ],
        hasMore: true,
      })),
    };
    const useCase = new ListVoiceNotesUseCase(notes);

    const page = await useCase.execute(ws, { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(typeof page.nextCursor).toBe("string");
    // The token is the keyset position of the LAST item — decoding it
    // (same codec the route uses to read cursors) must yield that row.
    expect(decodeVoiceNoteCursor(page.nextCursor!)).toEqual({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "note-older",
    });
  });

  it("forwards the after cursor to the port untouched", async () => {
    const after = {
      createdAt: new Date("2026-11-09T08:00:00.000Z"),
      id: "note-anchor",
    };
    const notes: VoiceNoteListPort = {
      listByWorkspace: vi.fn(async () => ({ notes: [], hasMore: false })),
    };
    const useCase = new ListVoiceNotesUseCase(notes);

    const page = await useCase.execute(ws, { limit: 10, after });

    expect(vi.mocked(notes.listByWorkspace)).toHaveBeenCalledWith(ws, {
      limit: 10,
      after,
    });
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
