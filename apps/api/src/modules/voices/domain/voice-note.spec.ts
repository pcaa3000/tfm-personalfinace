import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  VOICE_MEDIA_RETENTION_DAYS,
  VOICE_NOTE_STATUSES,
  VoiceNote,
  type VoiceNoteState,
} from "./voice-note.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const NOW = new Date("2026-11-10T12:00:00.000Z");

function quarantineInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-1",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-1/note-1.webm",
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 1234,
    fileHash: "a".repeat(64),
    now: NOW,
    ...overrides,
  };
}

function quarantined(now: Date = NOW): VoiceNote {
  const note = VoiceNote.quarantine(quarantineInput({ now }));
  if (!note.ok) throw note.error;
  return note.value;
}

describe("VoiceNote — lifecycle (voice-drafts T1, S5)", () => {
  it("declares the pending→draft_ready→confirmed|rejected|failed status set", () => {
    expect(VOICE_NOTE_STATUSES).toEqual([
      "pending",
      "draft_ready",
      "confirmed",
      "rejected",
      "failed",
    ]);
  });

  it("quarantine creates a pending note with expiresAt = createdAt + 30 days — fixed, not configurable (S7)", () => {
    const note = quarantined();

    expect(VOICE_MEDIA_RETENTION_DAYS).toBe(30);
    expect(note.status).toBe("pending");
    expect(note.isTerminal).toBe(false);
    expect(note.createdAt).toEqual(NOW);
    expect(note.updatedAt).toEqual(NOW);
    expect(note.expiresAt.getTime()).toBe(
      NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    expect(note.mediaDeletedAt).toBeNull();
    expect(note.transcript).toBeNull();
    expect(note.draftPayload).toBeNull();
    expect(note.extractedPayload).toBeNull();
    expect(note.transactionId).toBeNull();
    expect(note.error).toBeNull();
  });

  it.each([
    ["id", { id: "" }],
    ["uploaderSubject", { uploaderSubject: "" }],
    ["storageKey", { storageKey: " " }],
    ["mimeType", { mimeType: "" }],
    ["fileHash", { fileHash: "" }],
  ])("rejects an empty %s with VOICE_NOTE_INVALID", (_field, override) => {
    const note = VoiceNote.quarantine(quarantineInput(override));
    expect(note.ok).toBe(false);
    if (!note.ok) {
      expect(note.error.code).toBe("VOICE_NOTE_INVALID");
    }
  });

  it("rejects an empty originalFilename with VOICE_NOTE_INVALID", () => {
    const note = VoiceNote.quarantine(
      quarantineInput({ originalFilename: "   " }),
    );
    expect(note.ok).toBe(false);
    if (!note.ok) {
      expect(note.error.code).toBe("VOICE_NOTE_INVALID");
    }
  });

  it("rejects an originalFilename over 255 chars and a non-positive sizeBytes", () => {
    const longName = VoiceNote.quarantine(
      quarantineInput({ originalFilename: `${"a".repeat(256)}.webm` }),
    );
    expect(longName.ok).toBe(false);

    for (const sizeBytes of [0, -5, 1.5]) {
      const note = VoiceNote.quarantine(quarantineInput({ sizeBytes }));
      expect(note.ok).toBe(false);
      if (!note.ok) {
        expect(note.error.code).toBe("VOICE_NOTE_INVALID");
      }
    }
  });

  it("markDraftReady carries extraction, draft and transcript — pending → draft_ready (S7)", () => {
    const note = quarantined();
    const later = new Date("2026-11-10T12:00:20.000Z");
    const extracted = { transcript: "compré un sol de pan", type: "expense" };
    const draft = { concept: "pan", splits: [] };

    note.markDraftReady(extracted, draft, "compré un sol de pan", later);

    expect(note.status).toBe("draft_ready");
    expect(note.extractedPayload).toEqual(extracted);
    expect(note.draftPayload).toEqual(draft);
    // S7: the transcript is persisted with the same sensitivity as audio.
    expect(note.transcript).toBe("compré un sol de pan");
    expect(note.error).toBeNull();
    expect(note.updatedAt).toEqual(later);
    expect(note.isTerminal).toBe(false);
  });

  it("markConfirmed links the recorded transaction and is terminal", () => {
    const note = quarantined();
    note.markDraftReady({}, {}, "t", NOW);
    const later = new Date("2026-11-10T12:05:00.000Z");

    note.markConfirmed("trx-1", later);

    expect(note.status).toBe("confirmed");
    expect(note.transactionId).toBe("trx-1");
    expect(note.updatedAt).toEqual(later);
    expect(note.isTerminal).toBe(true);
  });

  it("markRejected is terminal", () => {
    const note = quarantined();
    note.markRejected(NOW);
    expect(note.status).toBe("rejected");
    expect(note.isTerminal).toBe(true);
  });

  it("markFailed records a truncated error and is terminal", () => {
    const note = quarantined();
    note.markFailed("x".repeat(600), NOW);
    expect(note.status).toBe("failed");
    expect(note.error).toHaveLength(500);
    expect(note.isTerminal).toBe(true);
  });

  it("resetToPending sends a failed note back to pending for retry (same storageKey, no re-upload)", () => {
    const note = quarantined();
    note.markFailed("pipeline blew up", NOW);
    const later = new Date("2026-11-10T13:00:00.000Z");

    note.resetToPending(later);

    expect(note.status).toBe("pending");
    expect(note.error).toBeNull();
    expect(note.updatedAt).toEqual(later);
    // The original storage key is reused — the audio is never re-uploaded.
    expect(note.storageKey).toBe("quarantine/ws-1/note-1.webm");
  });

  it("markMediaDeleted stamps the deletion instant; restoreMedia clears it on re-store (S7)", () => {
    const note = quarantined();
    const deleted = new Date("2026-11-15T08:30:00.000Z");

    note.markMediaDeleted(deleted);
    expect(note.mediaDeletedAt).toEqual(deleted);
    expect(note.updatedAt).toEqual(deleted);
    // The row and its status survive — only the medium is gone.
    expect(note.status).toBe("pending");

    const restored = new Date("2026-11-16T08:30:00.000Z");
    note.restoreMedia(restored);
    expect(note.mediaDeletedAt).toBeNull();
    expect(note.updatedAt).toEqual(restored);
  });
});

describe("VoiceNote — reconstitute (voice-drafts T1, S5)", () => {
  it("rebuilds the persisted state including the transcript without re-validating", () => {
    const state: VoiceNoteState = {
      id: "note-9",
      workspaceId: WS.value,
      uploaderSubject: "user-1",
      storageKey: "quarantine/ws-1/note-9.webm",
      originalFilename: "nota.webm",
      mimeType: "audio/webm",
      sizeBytes: 42,
      status: "draft_ready",
      extractedPayload: { transcript: "cobré cien" },
      draftPayload: { concept: "mantenimiento" },
      transcript: "cobré cien",
      transactionId: null,
      fileHash: "b".repeat(64),
      error: null,
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-20T10:00:00.000Z"),
      expiresAt: new Date("2026-10-31T10:00:00.000Z"),
      mediaDeletedAt: null,
    };

    const note = VoiceNote.reconstitute(state);

    expect(note.id).toBe("note-9");
    expect(note.status).toBe("draft_ready");
    expect(note.transcript).toBe("cobré cien");
    expect(note.expiresAt).toEqual(state.expiresAt);
    expect(note.mediaDeletedAt).toBeNull();
  });
});
