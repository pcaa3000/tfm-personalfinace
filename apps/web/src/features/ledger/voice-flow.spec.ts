import { describe, expect, it, vi } from "vitest";

import type { VoiceDraftPayload, VoiceNoteView } from "./voice-draft";
import {
  awaitVoiceDraft,
  uploadAndAwaitVoiceDraft,
  VoiceNoteFailedError,
  VoicePollTimeoutError,
} from "./voice-flow";

const file = new File(["bytes"], "voz.webm", { type: "audio/webm" });

function noteView(
  status: VoiceNoteView["status"],
  error: string | null = null,
): VoiceNoteView {
  return {
    id: "vn-1",
    workspaceId: "ws-1",
    status,
    originalFilename: "voz.webm",
    mimeType: "audio/webm",
    sizeBytes: 5,
    transactionId: null,
    transcript: null,
    error,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    expiresAt: "2026-11-02T00:00:00.000Z",
    mediaDeletedAt: null,
  };
}

const draft: VoiceDraftPayload = {
  transcript: "compré un sachet de champú",
  type: "expense",
  concept: "Champú",
  businessDate: "2026-10-03",
  dateHint: null,
  currency: "PEN",
  currencyConflict: false,
  totalMinorUnits: 70,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 70,
      itemCount: 1,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
  ],
  items: [],
};

describe("uploadAndAwaitVoiceDraft (voice-drafts T4, S1+S2)", () => {
  it("uploads, reports phases, polls until draft_ready and returns the draft", async () => {
    const phases: string[] = [];
    const getNote = vi
      .fn()
      .mockResolvedValueOnce(noteView("pending"))
      .mockResolvedValueOnce(noteView("pending"))
      .mockResolvedValueOnce(noteView("draft_ready"));
    const getDraft = vi.fn(async () => draft);
    const upload = vi.fn(async () => noteView("pending"));
    const sleep = vi.fn(async () => {});

    const result = await uploadAndAwaitVoiceDraft(file, {
      upload,
      getNote,
      getDraft,
      sleep,
      now: () => 0,
      pollIntervalMs: 2000,
      timeoutMs: 60_000,
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["uploading", "analyzing"]);
    expect(upload).toHaveBeenCalledWith(file);
    expect(getNote).toHaveBeenCalledTimes(3);
    expect(getDraft).toHaveBeenCalledWith("vn-1");
    expect(result.note.status).toBe("draft_ready");
    expect(result.draft).toBe(draft);
  });

  it("rejects with VoiceNoteFailedError when the pipeline marks the note failed", async () => {
    const upload = vi.fn(async () => noteView("pending"));
    const getNote = vi.fn(async () =>
      noteView("failed", "gemini quota exceeded"),
    );

    const error = await uploadAndAwaitVoiceDraft(file, {
      upload,
      getNote,
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoiceNoteFailedError);
    expect((error as VoiceNoteFailedError).noteError).toBe(
      "gemini quota exceeded",
    );
  });

  it("rejects when the note reaches a terminal status without a draft", async () => {
    const upload = vi.fn(async () => noteView("pending"));
    const getNote = vi.fn(async () => noteView("rejected"));

    const error = await uploadAndAwaitVoiceDraft(file, {
      upload,
      getNote,
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoiceNoteFailedError);
  });

  it("rejects with VoicePollTimeoutError after the polling budget", async () => {
    let clock = 0;
    const upload = vi.fn(async () => noteView("pending"));
    const getNote = vi.fn(async () => noteView("pending"));

    const error = await uploadAndAwaitVoiceDraft(file, {
      upload,
      getNote,
      getDraft: vi.fn(),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      pollIntervalMs: 2000,
      timeoutMs: 5000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoicePollTimeoutError);
  });

  it("propagates a network TypeError so the UI can show the offline message", async () => {
    const upload = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await uploadAndAwaitVoiceDraft(file, {
      upload,
      getNote: vi.fn(),
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
  });
});

describe("awaitVoiceDraft — resume polling an existing note (S11 pattern)", () => {
  it("polls the same note id until draft_ready without any upload", async () => {
    const getNote = vi
      .fn()
      .mockResolvedValueOnce(noteView("pending"))
      .mockResolvedValueOnce(noteView("draft_ready"));
    const getDraft = vi.fn(async () => draft);

    const result = await awaitVoiceDraft(noteView("pending"), {
      getNote,
      getDraft,
      sleep: async () => {},
      now: () => 0,
    });

    expect(getNote).toHaveBeenCalledTimes(2);
    expect(getNote).toHaveBeenCalledWith("vn-1");
    expect(result.note.status).toBe("draft_ready");
    expect(result.draft).toBe(draft);
  });

  it("reports every observed note through onNote so the caller keeps the noteId", async () => {
    const seen: string[] = [];
    const getNote = vi.fn(async () => noteView("draft_ready"));

    await awaitVoiceDraft(noteView("pending"), {
      getNote,
      getDraft: vi.fn(async () => draft),
      sleep: async () => {},
      now: () => 0,
      onNote: (note) => seen.push(`${note.id}:${note.status}`),
    });

    expect(seen).toEqual(["vn-1:pending", "vn-1:draft_ready"]);
  });

  it("attaches the noteId to the poll timeout error", async () => {
    let clock = 0;

    const error = await awaitVoiceDraft(noteView("pending"), {
      getNote: vi.fn(async () => noteView("pending")),
      getDraft: vi.fn(),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      pollIntervalMs: 2000,
      timeoutMs: 5000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoicePollTimeoutError);
    expect((error as VoicePollTimeoutError).noteId).toBe("vn-1");
  });

  it("attaches the noteId to the note failure error", async () => {
    const error = await awaitVoiceDraft(noteView("failed", "boom"), {
      getNote: vi.fn(),
      getDraft: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoiceNoteFailedError);
    expect((error as VoiceNoteFailedError).noteId).toBe("vn-1");
    expect((error as VoiceNoteFailedError).noteError).toBe("boom");
  });
});
