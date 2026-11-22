import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { RejectVoiceNoteUseCase } from "./reject-voice-note.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");
const clock: Clock = { now: () => NOW };

function note(status: "pending" | "draft_ready" | "confirmed" | "rejected" | "failed"): VoiceNote {
  const created = VoiceNote.quarantine({
    id: "note-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "k",
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 10,
    fileHash: "a".repeat(64),
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const entity = created.value;
  switch (status) {
    case "draft_ready":
      entity.markDraftReady({ raw: true }, { splits: [] }, "t", NOW);
      break;
    case "confirmed":
      entity.markDraftReady({ raw: true }, { splits: [] }, "t", NOW);
      entity.markConfirmed("trx-1", NOW);
      break;
    case "rejected":
      entity.markRejected(NOW);
      break;
    case "failed":
      entity.markFailed("boom", NOW);
      break;
  }
  return entity;
}

function buildDeps(entity: VoiceNote | null) {
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => entity),
  };
  return { useCase: new RejectVoiceNoteUseCase(notes, clock), notes };
}

describe("RejectVoiceNoteUseCase — user discard (voice-drafts T3, S5)", () => {
  it.each(["pending", "draft_ready"] as const)(
    "rejects a non-terminal %s note and persists it",
    async (status) => {
      const entity = note(status);
      const { useCase, notes } = buildDeps(entity);

      const result = await useCase.execute(WS_A, "note-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("rejected");
      expect(entity.status).toBe("rejected");
      expect(notes.save).toHaveBeenCalledWith(entity);
    },
  );

  it.each(["confirmed", "rejected", "failed"] as const)(
    "conflicts on a terminal %s note with VOICE_ALREADY_FINAL",
    async (status) => {
      const entity = note(status);
      const { useCase, notes } = buildDeps(entity);

      const result = await useCase.execute(WS_A, "note-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VOICE_ALREADY_FINAL");
      }
      expect(notes.save).not.toHaveBeenCalled();
    },
  );

  it("rejects with VOICE_NOT_FOUND for a missing or foreign note", async () => {
    const { useCase } = buildDeps(null);

    const result = await useCase.execute(WS_A, "nope");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });
});
