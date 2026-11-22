import { describe, expect, it, vi } from "vitest";

import {
  DomainError,
  err,
  ok,
  type Result,
} from "../modules/shared-kernel/index.js";
import {
  VoiceNote,
  type VoiceNoteState,
  type VoiceNoteStatus,
} from "../modules/voices/index.js";
import type {
  VoiceNoteRepositoryPort,
  VoiceStoragePort,
  VoiceDraftPort,
  VoiceWorkspaceContextPort,
  VoiceWorkspaceContext,
} from "../modules/voices/index.js";
import type { VoiceExtraction } from "../modules/voices/domain/voice-extraction.js";
import type {
  CategoryCatalogPort,
  CategoryView,
} from "../modules/categorization/index.js";
import { handleVoiceDraft, type VoiceDraftJob } from "./voice-draft.js";

const WS = "ws-1";
const NOW = new Date("2026-11-10T12:00:00.000Z");

const CATALOG: CategoryView[] = [
  { id: "c1", key: "groceries", label: "Groceries", nature: "essential", custom: true },
];

const WS_CONTEXT: VoiceWorkspaceContext = {
  timezone: "America/Lima",
  defaultCurrency: "PEN",
};

const EXTRACTION: VoiceExtraction = {
  transcript: "compré un sol de pan",
  type: "expense",
  concept: "Compra de pan",
  dateHint: "ayer",
  totalMinorUnits: 100,
  items: [
    {
      concept: "Pan",
      amountMinorUnits: 100,
      currency: null,
      suggestedCategoryKey: "groceries",
      suggestedNewCategory: null,
      confidence: 0.9,
    },
  ],
};

function noteState(status: VoiceNoteStatus): VoiceNoteState {
  return {
    id: "note-1",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: `quarantine/${WS}/note-1.webm`,
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 10,
    status,
    extractedPayload: null,
    draftPayload: null,
    transcript: null,
    transactionId: null,
    fileHash: "hash-1",
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    mediaDeletedAt: null,
  };
}

function makeDeps(options: {
  status?: VoiceNoteStatus;
  found?: boolean;
  bytes?: Uint8Array | null;
  context?: VoiceWorkspaceContext | null;
  processResult?: Result<VoiceExtraction, DomainError>;
}) {
  const saved: VoiceNote[] = [];
  const note =
    options.found === false
      ? null
      : VoiceNote.reconstitute(noteState(options.status ?? "pending"));
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async (n: VoiceNote) => {
      saved.push(n);
    }),
    findById: vi.fn(async () => note),
  };
  const storage: VoiceStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () =>
      "bytes" in options ? options.bytes! : Uint8Array.from([1, 2, 3]),
    ),
    delete: vi.fn(async () => undefined),
  };
  const categories: CategoryCatalogPort = {
    listForWorkspace: vi.fn(async () => CATALOG),
  };
  const processor: VoiceDraftPort = {
    processAudio: vi.fn(async () => options.processResult ?? ok(EXTRACTION)),
  };
  const workspaceContext: VoiceWorkspaceContextPort = {
    findContext: vi.fn(async () =>
      "context" in options ? options.context! : WS_CONTEXT,
    ),
  };
  const deps = {
    notes,
    storage,
    categories,
    processor,
    workspaceContext,
    clock: { now: () => NOW },
  };
  return { deps, notes, storage, categories, processor, workspaceContext, saved, note };
}

const JOB: VoiceDraftJob = { voiceNoteId: "note-1", workspaceId: WS };

describe("handleVoiceDraft — voice-draft job (voice-drafts T2, S2+S3+S4+S5+S7)", () => {
  it("pending note → stores extraction + grouped draft + transcript, status draft_ready", async () => {
    const { deps, saved, processor, storage, categories } = makeDeps({});

    await handleVoiceDraft(deps, JOB);

    expect(storage.open).toHaveBeenCalledWith("quarantine/ws-1/note-1.webm");
    expect(categories.listForWorkspace).toHaveBeenCalled();
    expect(processor.processAudio).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "audio/webm",
      CATALOG,
    );
    expect(saved).toHaveLength(1);
    const done = saved[0]!;
    expect(done.status).toBe("draft_ready");
    expect(done.extractedPayload).toEqual(EXTRACTION);
    // S7: the transcript is persisted on the row, not just the payload.
    expect(done.transcript).toBe("compré un sol de pan");
    const draft = done.draftPayload as {
      type: string;
      transcript: string;
      businessDate: string;
      currency: string;
      totalMismatch: boolean;
      splits: Array<Record<string, unknown>>;
      items: unknown[];
    };
    expect(draft.type).toBe("expense");
    expect(draft.transcript).toBe("compré un sol de pan");
    // "ayer" resolved against the business date in the workspace tz —
    // 2026-11-10T12:00Z is still 2026-11-10 in America/Lima, so ayer → 09.
    expect(draft.businessDate).toBe("2026-11-09");
    expect(draft.currency).toBe("PEN"); // workspace default — no item currency
    expect(draft.totalMismatch).toBe(false);
    expect(draft.splits[0]).toMatchObject({
      categoryKey: "groceries",
      amountMinorUnits: 100,
      itemCount: 1,
    });
    expect(draft.items).toHaveLength(1);
    expect(done.error).toBeNull();
  });

  it("resolves the business date in the workspace timezone — a UTC day that is already tomorrow elsewhere still uses the workspace day", async () => {
    // 2026-11-10T23:30Z is 2026-11-11 in Europe/Madrid but 2026-11-10 in
    // America/Lima — the draft must date itself with the workspace tz.
    const lateNow = new Date("2026-11-10T23:30:00.000Z");
    const { deps, saved } = makeDeps({});

    await handleVoiceDraft(
      {
        ...deps,
        workspaceContext: {
          findContext: async () => ({
            timezone: "America/Lima",
            defaultCurrency: "PEN",
          }),
        },
        clock: { now: () => lateNow },
      },
      JOB,
    );

    const draft = saved[0]!.draftPayload as { businessDate: string };
    expect(draft.businessDate).toBe("2026-11-09"); // "ayer" from 2026-11-10 Lima
  });

  it("skips a note that is not pending (at-least-once redelivery is idempotent)", async () => {
    const { deps, notes, storage, processor, saved } = makeDeps({
      status: "draft_ready",
    });

    await handleVoiceDraft(deps, JOB);

    expect(storage.open).not.toHaveBeenCalled();
    expect(processor.processAudio).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("missing note row → logs and returns without touching the pipeline", async () => {
    const { deps, storage, processor, notes } = makeDeps({ found: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleVoiceDraft(deps, JOB);

    expect(storage.open).not.toHaveBeenCalled();
    expect(processor.processAudio).not.toHaveBeenCalled();
    expect(notes.save).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("missing object bytes → status failed with error, row still saved", async () => {
    const { deps, saved, processor } = makeDeps({ bytes: null });

    await handleVoiceDraft(deps, JOB);

    expect(processor.processAudio).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toMatch(/storage|missing/i);
  });

  it("missing workspace context → status failed instead of guessing dates/currency", async () => {
    const { deps, saved, processor } = makeDeps({ context: null });

    await handleVoiceDraft(deps, JOB);

    expect(processor.processAudio).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toMatch(/workspace/i);
  });

  it("processor error → status failed with the domain error recorded", async () => {
    const { deps, saved } = makeDeps({
      processResult: err(new DomainError("VOICE_DRAFT_FAILED", "bad json")),
    });

    await handleVoiceDraft(deps, JOB);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("VOICE_DRAFT_FAILED");
    expect(saved[0]!.error).toContain("bad json");
  });

  it("unexpected throw → marks failed instead of letting it escape the handler", async () => {
    const { deps, saved, processor } = makeDeps({});
    vi.mocked(processor.processAudio).mockRejectedValueOnce(new Error("boom"));

    await expect(handleVoiceDraft(deps, JOB)).resolves.toBeUndefined();
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("boom");
  });

  it("a findById rejection still resolves with the row marked failed — a transient DB error must not strand the note pending (R3-001)", async () => {
    const { deps, notes, saved } = makeDeps({});
    vi.mocked(notes.findById).mockRejectedValueOnce(new Error("db down"));

    await expect(handleVoiceDraft(deps, JOB)).resolves.toBeUndefined();

    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("db down");
  });

  it("when the row cannot even be re-read, the failure escapes so the dispatcher can redeliver (R4-002)", async () => {
    const { deps, notes } = makeDeps({});
    vi.mocked(notes.findById).mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handleVoiceDraft(deps, JOB)).rejects.toThrow("db down");

    expect(notes.save).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("a save rejection with the row still persisted pending marks the re-read row failed — in-memory status is not the discriminator (R3-001/R4-001)", async () => {
    const { deps, notes, note, saved } = makeDeps({});
    const persistedPending = VoiceNote.reconstitute(noteState("pending"));
    vi.mocked(notes.findById)
      .mockResolvedValueOnce(note)
      .mockResolvedValue(persistedPending);
    vi.mocked(notes.save).mockRejectedValueOnce(
      new Error("deadlock before commit"),
    );

    await expect(handleVoiceDraft(deps, JOB)).resolves.toBeUndefined();

    // The entity advanced to draft_ready in memory, but the persisted row
    // never committed: the recovery path must mark the re-read row failed.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(persistedPending);
    expect(saved[0]!.status).toBe("failed");
    expect(saved[0]!.error).toContain("deadlock");
  });

  it("a save rejection after the draft_ready transition never downgrades the row back to failed (R3-003)", async () => {
    const { deps, notes, note } = makeDeps({});
    vi.mocked(notes.save).mockRejectedValueOnce(
      new Error("dropped connection after commit"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(handleVoiceDraft(deps, JOB)).resolves.toBeUndefined();

    // The persist failure is logged, not re-marked: the entity already
    // advanced to draft_ready, so markFailed must never overwrite it.
    expect(notes.save).toHaveBeenCalledTimes(1);
    expect(note!.status).toBe("draft_ready");
    expect(note!.error).toBeNull();
    log.mockRestore();
  });
});
