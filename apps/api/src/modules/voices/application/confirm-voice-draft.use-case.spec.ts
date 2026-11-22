import { describe, expect, it, vi } from "vitest";

import type { CategoryView } from "../../categorization/index.js";
import {
  Category,
  CreateCategoryUseCase,
  type CategoryCatalogPort,
  type SystemCategoryPort,
} from "../../categorization/index.js";
import type {
  Clock,
  RecordManualTransactionCommand,
  RecordManualTransactionUseCase,
  TransactionRepositoryPort,
  TransactionView,
} from "../../ledger/index.js";
import {
  BusinessDate,
  DomainError,
  Money,
  WorkspaceId,
  err,
  ok,
} from "../../shared-kernel/index.js";
import { Transaction, categorized } from "../../ledger/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import type { VoiceDraftPayload } from "../domain/voice-draft.js";
import type { VoiceNoteRepositoryPort } from "./ports/voice-note-repository.port.js";
import {
  ConfirmVoiceDraftUseCase,
  type ConfirmVoiceDraftCommand,
} from "./confirm-voice-draft.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");
const clock: Clock = { now: () => NOW };

const DRAFT: VoiceDraftPayload = {
  transcript: "compré arroz y un sachet de champú",
  type: "expense",
  concept: "Compra bodega",
  businessDate: "2026-11-10",
  dateHint: null,
  currency: "PEN",
  currencyConflict: false,
  totalMinorUnits: 3550,
  totalMismatch: false,
  splits: [],
  items: [],
};

const TX_VIEW: TransactionView = {
  id: "trx-1",
  workspaceId: "ws-a",
  type: "expense",
  amount: "35.50",
  currency: "PEN",
  businessDate: "2026-11-10",
  timezone: "America/Lima",
  concept: "Compra bodega",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "voice",
  originReference: "note-1",
  confirmedAt: NOW.toISOString(),
  revisionCount: 0,
  splits: [
    { categoryId: "cat-food", amount: "20.00" },
    { categoryId: "cat-new", amount: "10.00" },
    { categoryId: "sys-uncat", amount: "5.50" },
  ],
};

const UNCATEGORIZED_VIEW: CategoryView = {
  id: "sys-uncat",
  key: "uncategorized",
  label: "Sin categorizar",
  nature: "uncategorized",
  custom: false,
};

const CREATED_VIEW: CategoryView = {
  id: "cat-new",
  key: "cuidado_personal",
  label: "Cuidado personal",
  nature: "essential",
  custom: true,
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
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!note.ok) throw note.error;
  return note.value;
}

function draftReadyNote(): VoiceNote {
  const note = quarantinedNote();
  note.markDraftReady(
    { raw: true },
    DRAFT,
    DRAFT.transcript,
    new Date("2026-11-10T12:05:00.000Z"),
  );
  return note;
}

function confirmedNote(transactionId = "trx-1"): VoiceNote {
  const note = draftReadyNote();
  note.markConfirmed(transactionId, new Date("2026-11-10T12:10:00.000Z"));
  return note;
}

interface Deps {
  notes: VoiceNoteRepositoryPort;
  transactions: Pick<TransactionRepositoryPort, "findById">;
  recordManual: Pick<RecordManualTransactionUseCase, "execute">;
  createCategory: Pick<CreateCategoryUseCase, "execute">;
  catalog: CategoryCatalogPort;
  systemCategories: SystemCategoryPort;
}

function buildDeps(overrides: Partial<Deps> = {}) {
  const notes: VoiceNoteRepositoryPort = {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => draftReadyNote()),
  };
  const transactions: Pick<TransactionRepositoryPort, "findById"> = {
    findById: vi.fn(async () => null),
  };
  const recordManual = {
    execute: vi.fn(async (_c: RecordManualTransactionCommand) => ok(TX_VIEW)),
  };
  const createCategory = {
    execute: vi.fn(async () => ok(CREATED_VIEW)),
  };
  const catalog: CategoryCatalogPort = {
    listForWorkspace: vi.fn(async () => [
      {
        id: "cat-food",
        key: "food",
        label: "Comida",
        nature: "essential",
        custom: true,
      },
      {
        id: "cat-mascotas",
        key: "mascotas",
        label: "Mascotas",
        nature: "discretionary",
        custom: true,
      },
    ]),
  };
  const systemCategories: SystemCategoryPort = {
    ensureUncategorized: vi.fn(async () => UNCATEGORIZED_VIEW),
  };
  const deps: Deps = {
    notes,
    transactions,
    recordManual,
    createCategory,
    catalog,
    systemCategories,
    ...overrides,
  };
  const useCase = new ConfirmVoiceDraftUseCase(
    deps.notes,
    deps.transactions,
    deps.recordManual,
    deps.createCategory,
    deps.catalog,
    deps.systemCategories,
    clock,
  );
  return { useCase, deps };
}

function command(
  overrides: Partial<ConfirmVoiceDraftCommand> = {},
): ConfirmVoiceDraftCommand {
  return {
    workspaceId: WS_A,
    voiceNoteId: "note-1",
    accountId: "acc-1",
    type: "expense",
    idempotencyKey: "confirm-note-1",
    timezone: "America/Lima",
    defaultCurrency: "PEN",
    splits: [
      { categoryId: "cat-food", newCategory: null, amountMinorUnits: 2000 },
      {
        categoryId: null,
        newCategory: { name: "Cuidado personal", nature: "essential" },
        amountMinorUnits: 1000,
      },
      { categoryId: null, newCategory: null, amountMinorUnits: 550 },
    ],
    actor: "user-1",
    ...overrides,
  };
}

function reconstitutedTransaction(
  id: string,
  idempotencyKey: string,
): Transaction {
  const amount = Money.fromMinorUnits(3550n, "PEN");
  const businessDate = BusinessDate.create("2026-11-10", "America/Lima");
  if (!amount.ok || !businessDate.ok) throw new Error("fixture failed");
  return Transaction.reconstitute({
    id,
    workspaceId: WS_A,
    idempotencyKey,
    type: "expense",
    amount: amount.value,
    businessDate: businessDate.value,
    concept: "Compra bodega",
    accountId: "acc-1",
    destinationAccountId: null,
    category: categorized("cat-food"),
    status: "confirmed",
    origin: "voice",
    originReference: "note-1",
    confirmedAt: NOW,
    confirmedBy: "user-1",
    revisions: [],
    splits: [],
  });
}

describe("ConfirmVoiceDraftUseCase — draft approval (voice-drafts T3, S2+S4+S5)", () => {
  it("records the transaction with splits, amount derived from their sum, origin voice", async () => {
    const { useCase, deps } = buildDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction).toEqual(TX_VIEW);
    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent).toMatchObject({
      workspaceId: WS_A,
      idempotencyKey: "confirm-note-1",
      type: "expense",
      amount: "35.50",
      currency: "PEN",
      businessDate: "2026-11-10",
      timezone: "America/Lima",
      concept: "Compra bodega",
      accountId: "acc-1",
      origin: "voice",
      originReference: "note-1",
      actor: "user-1",
      splits: [
        { categoryId: "cat-food", amount: 2000 },
        { categoryId: "cat-new", amount: 1000 },
        { categoryId: "sys-uncat", amount: 550 },
      ],
    });
  });

  it("creates each newCategory via the catalog use case and reports it (S4)", async () => {
    const { useCase, deps } = buildDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deps.createCategory.execute).toHaveBeenCalledTimes(1);
    expect(deps.createCategory.execute).toHaveBeenCalledWith({
      workspaceId: WS_A,
      key: Category.deriveKey("Cuidado personal"),
      label: "Cuidado personal",
      nature: "essential",
    });
    expect(result.value.createdCategories).toEqual([CREATED_VIEW]);
  });

  it("reuses the existing workspace category when the derived key is taken (race-tolerant)", async () => {
    const createCategory = {
      execute: vi.fn(async () =>
        err(new DomainError("CATEGORY_KEY_TAKEN", "taken")),
      ),
    };
    const { useCase, deps } = buildDeps({ createCategory });

    const result = await useCase.execute(
      command({
        splits: [
          {
            categoryId: null,
            newCategory: { name: "Mascotas", nature: "discretionary" },
            amountMinorUnits: 800,
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.splits).toEqual([{ categoryId: "cat-mascotas", amount: 800 }]);
    expect(result.value.createdCategories).toEqual([]);
  });

  it("marks the note confirmed and links the transaction", async () => {
    const note = draftReadyNote();
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const { useCase, deps } = buildDeps({ notes });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    expect(note.status).toBe("confirmed");
    expect(note.transactionId).toBe("trx-1");
    expect(deps.notes.save).toHaveBeenCalledWith(note);
  });

  it("maps a null-category split to the system uncategorized category", async () => {
    const { useCase, deps } = buildDeps();

    const result = await useCase.execute(
      command({
        splits: [{ categoryId: null, newCategory: null, amountMinorUnits: 900 }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deps.systemCategories.ensureUncategorized).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.splits).toEqual([{ categoryId: "sys-uncat", amount: 900 }]);
  });

  it("derives businessDate/currency/concept from the draft when the body omits them", async () => {
    const { useCase, deps } = buildDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.businessDate).toBe("2026-11-10");
    expect(sent.currency).toBe("PEN");
    expect(sent.concept).toBe("Compra bodega");
  });

  it("lets the body override draft businessDate, currency and concept", async () => {
    const { useCase, deps } = buildDeps();

    await useCase.execute(
      command({
        businessDate: "2026-11-11",
        currency: "USD",
        concept: "edited concept",
      }),
    );

    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.businessDate).toBe("2026-11-11");
    expect(sent.currency).toBe("USD");
    expect(sent.concept).toBe("edited concept");
  });

  it("falls back to the workspace default currency / today when the stored payload lacks them", async () => {
    const note = quarantinedNote();
    // A legacy/partial payload with no currency or businessDate.
    const partial = {
      ...DRAFT,
      currency: undefined,
      businessDate: undefined,
    };
    note.markDraftReady({ raw: true }, partial, DRAFT.transcript, NOW);
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const { useCase, deps } = buildDeps({ notes });

    await useCase.execute(command());

    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.currency).toBe("PEN");
    expect(sent.businessDate).toBe("2026-11-10"); // clock date in the workspace timezone
  });

  it("rejects with VOICE_NOT_READY when the note is not draft_ready", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => quarantinedNote()),
    };
    const { useCase, deps } = buildDeps({ notes });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_READY");
    }
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
    expect(deps.notes.save).not.toHaveBeenCalled();
  });

  it("rejects with VOICE_NOT_FOUND for a missing or foreign note", async () => {
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_FOUND");
    }
  });

  it("rejects empty splits with VOICE_SPLITS_REQUIRED", async () => {
    const { useCase } = buildDeps();

    const result = await useCase.execute(command({ splits: [] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_SPLITS_REQUIRED");
    }
  });

  it("rejects with VOICE_DRAFT_INVALID when draft_ready carries no usable payload", async () => {
    const note = quarantinedNote();
    note.markDraftReady(
      { raw: true },
      { nope: true },
      DRAFT.transcript,
      NOW,
    );
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const { useCase } = buildDeps({ notes });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_DRAFT_INVALID");
    }
    // No side effects: nothing recorded, nothing saved.
  });

  it("propagates a category creation failure without saving the note", async () => {
    const createCategory = {
      execute: vi.fn(async () =>
        err(new DomainError("CATEGORY_INVALID_NATURE", "bad nature")),
      ),
    };
    const catalog: CategoryCatalogPort = {
      listForWorkspace: vi.fn(async () => []),
    };
    const { useCase, deps } = buildDeps({ createCategory, catalog });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CATEGORY_INVALID_NATURE");
    }
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
    expect(deps.notes.save).not.toHaveBeenCalled();
  });

  it("propagates a recordManual failure and keeps the note draft_ready", async () => {
    const note = draftReadyNote();
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const recordManual = {
      execute: vi.fn(async () =>
        err(new DomainError("ACCOUNT_CURRENCY_MISMATCH", "mismatch")),
      ),
    };
    const { useCase, deps } = buildDeps({ notes, recordManual });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
    expect(note.status).toBe("draft_ready");
    expect(deps.notes.save).not.toHaveBeenCalled();
  });

  it("returns the stored transaction on replay with the same idempotencyKey (no duplicates)", async () => {
    const note = confirmedNote("trx-1");
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const stored = reconstitutedTransaction("trx-1", "confirm-note-1");
    const transactions: Pick<TransactionRepositoryPort, "findById"> = {
      findById: vi.fn(async () => stored),
    };
    const { useCase, deps } = buildDeps({ notes, transactions });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction.id).toBe("trx-1");
    expect(result.value.createdCategories).toEqual([]);
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
    expect(deps.createCategory.execute).not.toHaveBeenCalled();
    expect(deps.notes.save).not.toHaveBeenCalled();
  });

  it("rejects a replay on a confirmed note when the idempotencyKey differs", async () => {
    const note = confirmedNote("trx-1");
    const notes: VoiceNoteRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => note),
    };
    const stored = reconstitutedTransaction("trx-1", "other-key");
    const transactions: Pick<TransactionRepositoryPort, "findById"> = {
      findById: vi.fn(async () => stored),
    };
    const { useCase } = buildDeps({ notes, transactions });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VOICE_NOT_READY");
    }
  });
});
