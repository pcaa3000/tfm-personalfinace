import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { GetVoiceNoteUseCase } from "./get-voice-note.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;
const wsB = WorkspaceId.create("ws-b");
if (!wsB.ok) throw new Error("workspace setup failed");
const WS_B = wsB.value;

function pendingNote(): VoiceNote {
  const note = VoiceNote.quarantine({
    id: "note-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/note-1.webm",
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 123,
    fileHash: "a".repeat(64),
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!note.ok) throw note.error;
  return note.value;
}

describe("GetVoiceNoteUseCase — polling read (voice-drafts T1)", () => {
  it("returns the note view for the owning workspace", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => pendingNote()),
    };
    const useCase = new GetVoiceNoteUseCase(notes);

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("note-1");
      expect(result.value.status).toBe("pending");
      expect(result.value.originalFilename).toBe("nota.webm");
      expect(result.value.transcript).toBeNull();
    }
    expect(notes.findById).toHaveBeenCalledWith(WS_A, "note-1");
  });

  it("maps a missing or foreign-workspace note to VOICE_NOT_FOUND", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => null),
    };
    const useCase = new GetVoiceNoteUseCase(notes);

    const result = await useCase.execute(WS_B, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });
});
