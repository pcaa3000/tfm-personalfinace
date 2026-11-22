import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { Clock } from "../../ledger/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceDraftDispatcher } from "./ports/voice-draft-dispatcher.port.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { RetryVoiceNoteUseCase } from "./retry-voice-note.use-case.js";

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

function buildDeps(
  entity: VoiceNote | null,
  dispatcher?: VoiceDraftDispatcher,
) {
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => entity),
  };
  const dispatch: VoiceDraftDispatcher = dispatcher ?? {
    enqueueDraft: vi.fn(async () => undefined),
  };
  return { useCase: new RetryVoiceNoteUseCase(notes, dispatch, clock), notes, dispatch };
}

describe("RetryVoiceNoteUseCase — retry without re-upload (voice-drafts T3, S5)", () => {
  it("resets a failed note to pending and re-enqueues the draft job over the same storageKey", async () => {
    const entity = note("failed");
    const enqueueDraft = vi.fn(async () => undefined);
    const { useCase, notes } = buildDeps(entity, { enqueueDraft });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");
    expect(entity.status).toBe("pending");
    expect(entity.error).toBeNull();
    // Same row, same storageKey — the audio is never re-uploaded.
    expect(entity.storageKey).toBe("k");
    expect(enqueueDraft).toHaveBeenCalledWith("note-1", "ws-a");
    expect(notes.save).toHaveBeenCalledWith(entity);
  });

  it.each(["pending", "draft_ready"] as const)(
    "is an idempotent no-op for a %s note — the pipeline is in flight or reviewable",
    async (status) => {
      const entity = note(status);
      const { useCase, notes, dispatch } = buildDeps(entity);

      const result = await useCase.execute(WS_A, "note-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe(status);
      expect(dispatch.enqueueDraft).not.toHaveBeenCalled();
      expect(notes.save).not.toHaveBeenCalled();
    },
  );

  it.each(["confirmed", "rejected"] as const)(
    "conflicts on a user-final %s note with VOICE_ALREADY_FINAL",
    async (status) => {
      const entity = note(status);
      const { useCase, dispatch } = buildDeps(entity);

      const result = await useCase.execute(WS_A, "note-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VOICE_ALREADY_FINAL");
      }
      expect(dispatch.enqueueDraft).not.toHaveBeenCalled();
    },
  );

  it("marks the note failed again when the re-enqueue dispatch fails (no lost pending row)", async () => {
    const entity = note("failed");
    const enqueueDraft = vi.fn(async () => {
      throw new Error("queue down");
    });
    const { useCase, notes } = buildDeps(entity, { enqueueDraft });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The pending row is never left without a job: the note lands back
    // in failed so the retry endpoint stays reachable.
    expect(entity.status).toBe("failed");
    expect(notes.save).toHaveBeenCalledTimes(2);
  });

  it("rejects with VOICE_NOT_FOUND for a missing or foreign note", async () => {
    const { useCase } = buildDeps(null);

    const result = await useCase.execute(WS_A, "nope");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });
});
