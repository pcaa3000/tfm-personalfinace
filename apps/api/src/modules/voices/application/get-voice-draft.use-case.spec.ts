import { describe, expect, it, vi } from "vitest";

import type {
  TransactionDuplicateCriteria,
  TransactionDuplicatesPort,
} from "../../receipts/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceDraftPayload } from "../domain/voice-draft.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import { GetVoiceDraftUseCase } from "./get-voice-draft.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");

const DRAFT: VoiceDraftPayload = {
  transcript: "compré un sachet de champú a 70 céntimos",
  type: "expense",
  concept: "Compra bodega",
  businessDate: "2026-11-10",
  dateHint: null,
  currency: "PEN",
  currencyConflict: false,
  totalMinorUnits: 220,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 220,
      itemCount: 1,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
  ],
  items: [],
};

function quarantinedNote(): VoiceNote {
  const note = VoiceNote.quarantine({
    id: "note-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/note-1.webm",
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 123,
    fileHash: "a".repeat(64),
    now: NOW,
  });
  if (!note.ok) throw note.error;
  return note.value;
}

function draftReadyNote(
  payload: VoiceDraftPayload = DRAFT,
  transcript = "compré un sachet de champú a 70 céntimos",
): VoiceNote {
  const note = quarantinedNote();
  note.markDraftReady({ raw: true }, payload, transcript, NOW);
  return note;
}

function buildDeps(overrides: {
  notes?: VoiceNoteRepositoryPort;
  duplicates?: TransactionDuplicatesPort;
} = {}) {
  const notes: VoiceNoteRepositoryPort = overrides.notes ?? {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => draftReadyNote()),
  };
  const duplicates: TransactionDuplicatesPort = overrides.duplicates ?? {
    findExpenseCandidates: vi.fn(async () => []),
  };
  return { useCase: new GetVoiceDraftUseCase(notes, duplicates), notes, duplicates };
}

describe("GetVoiceDraftUseCase — draft read (voice-drafts T3, S2+S4)", () => {
  it("returns the stored payload with transcript and read-time possibleDuplicates", async () => {
    const duplicate = {
      transactionId: "trx-dup",
      concept: "Compra bodega",
      amount: 220,
      occurredOn: "2026-11-10",
    };
    const findExpenseCandidates = vi.fn(async () => [duplicate]);
    const { useCase } = buildDeps({
      duplicates: { findExpenseCandidates },
    });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transcript).toBe(
      "compré un sachet de champú a 70 céntimos",
    );
    expect(result.value.splits).toHaveLength(1);
    expect(result.value.possibleDuplicates).toEqual([duplicate]);
  });

  it("queries duplicates with amount ±3-day window and the draft concept as the text signal", async () => {
    const findExpenseCandidates = vi.fn(
      async (_workspaceId: WorkspaceId, _criteria: TransactionDuplicateCriteria) =>
        [],
    );
    const { useCase } = buildDeps({
      duplicates: { findExpenseCandidates },
    });

    await useCase.execute(WS_A, "note-1");

    expect(findExpenseCandidates).toHaveBeenCalledWith(WS_A, {
      amountMinorUnits: 220,
      merchant: "Compra bodega",
      fromDate: "2026-11-07",
      toDate: "2026-11-13",
    });
  });

  it("falls back to the splits sum when the draft states no total", async () => {
    const draftNoTotal: VoiceDraftPayload = {
      ...DRAFT,
      totalMinorUnits: null,
      splits: [
        {
          categoryKey: "food",
          newCategory: null,
          amountMinorUnits: 150,
          itemCount: 1,
          confidenceAvg: 0.9,
          lowConfidence: false,
        },
        {
          categoryKey: null,
          newCategory: null,
          amountMinorUnits: 70,
          itemCount: 1,
          confidenceAvg: 0.4,
          lowConfidence: true,
        },
      ],
    };
    const findExpenseCandidates = vi.fn(async () => []);
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => draftReadyNote(draftNoTotal)),
    };
    const { useCase } = buildDeps({
      notes,
      duplicates: { findExpenseCandidates },
    });

    await useCase.execute(WS_A, "note-1");

    expect(findExpenseCandidates).toHaveBeenCalledWith(
      WS_A,
      expect.objectContaining({ amountMinorUnits: 220 }),
    );
  });

  it("rejects with VOICE_NOT_FOUND for a missing or foreign note", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(WS_A, "nope");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });

  it("rejects with VOICE_NOT_READY while the note is still pending", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => quarantinedNote()),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_READY");
    }
  });

  it("rejects with VOICE_NOT_READY on a terminal note", async () => {
    const note = draftReadyNote();
    note.markConfirmed("trx-1", NOW);
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_READY");
    }
  });

  it("rejects with VOICE_NOT_READY when the row claims draft_ready but carries no payload", async () => {
    const note = draftReadyNote();
    const hollow = VoiceNote.reconstitute({
      id: note.id,
      workspaceId: note.workspaceId.value,
      uploaderSubject: note.uploaderSubject,
      storageKey: note.storageKey,
      originalFilename: note.originalFilename,
      mimeType: note.mimeType,
      sizeBytes: note.sizeBytes,
      status: "draft_ready",
      extractedPayload: null,
      draftPayload: null,
      transactionId: null,
      fileHash: note.fileHash,
      transcript: null,
      error: null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      expiresAt: note.expiresAt,
      mediaDeletedAt: null,
    });
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => hollow),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(WS_A, "note-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_READY");
    }
  });
});
