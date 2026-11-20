import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import type { VoiceStoragePort } from "./ports/voice-storage.port.js";
import { GetVoiceFileUseCase } from "./get-voice-file.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const WEBM = Uint8Array.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
]);

function makeNote(mediaDeleted = false): VoiceNote {
  const note = VoiceNote.quarantine({
    id: "note-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/note-1.webm",
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: WEBM.byteLength,
    fileHash: "a".repeat(64),
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!note.ok) throw note.error;
  if (mediaDeleted) {
    note.value.markMediaDeleted(new Date("2026-11-20T12:00:00.000Z"));
  }
  return note.value;
}

function makeDeps(note: VoiceNote | null, bytes: Uint8Array | null = WEBM) {
  const storage: VoiceStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => bytes),
    delete: vi.fn(async () => undefined),
  };
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(),
    findById: vi.fn(async () => note),
  };
  return { useCase: new GetVoiceFileUseCase(notes, storage), storage };
}

describe("GetVoiceFileUseCase — media retention (voice-drafts T1, S7)", () => {
  it("streams the stored bytes while media exists", async () => {
    const { useCase } = makeDeps(makeNote());

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bytes).toEqual(WEBM);
      expect(result.value.mimeType).toBe("audio/webm");
      expect(result.value.originalFilename).toBe("nota.webm");
    }
  });

  it("returns VOICE_NOT_FOUND for a missing or foreign note", async () => {
    const { useCase } = makeDeps(null);

    const result = await useCase.execute(WS_A, "note-9");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });

  it("returns VOICE_MEDIA_DELETED when the medium was purged — never reads storage", async () => {
    const { useCase, storage } = makeDeps(makeNote(true));

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Distinct from VOICE_NOT_FOUND (404): the route maps it to 410 so
      // clients tell "media gone" apart from "note not found".
      expect(result.error.code).toBe("VOICE_MEDIA_DELETED");
    }
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("returns VOICE_MEDIA_DELETED when the stored object is missing (drift also reads as media gone)", async () => {
    const { useCase } = makeDeps(makeNote(), null);

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_MEDIA_DELETED");
    }
  });
});
