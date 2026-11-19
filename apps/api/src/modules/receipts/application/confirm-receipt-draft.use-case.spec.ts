import { describe, expect, it, vi } from "vitest";

import type { CategoryView } from "../../categorization/index.js";
import {
  Category,
  CreateCategoryUseCase,
  type CategoryCatalogPort,
  type SystemCategoryPort,
} from "../../categorization/index.js";
import type {
  RecordManualTransactionCommand,
  RecordManualTransactionUseCase,
  TransactionRepositoryPort,
  TransactionView,
} from "../../ledger/index.js";
import {
  DomainError,
  WorkspaceId,
  err,
  ok,
} from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptDraftPayload } from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { Clock } from "../../ledger/index.js";
import {
  ConfirmReceiptDraftUseCase,
  type ConfirmReceiptDraftCommand,
} from "./confirm-receipt-draft.use-case.js";
import {
  BusinessDate,
  Money,
} from "../../shared-kernel/index.js";
import { Transaction, categorized } from "../../ledger/index.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");
const clock: Clock = { now: () => NOW };

const DRAFT: ReceiptDraftPayload = {
  merchant: "Bodega Central",
  concept: "Bodega Central",
  businessDate: "2026-11-10",
  currency: "PEN",
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
  concept: "Bodega Central",
  accountId: "acc-1",
  destinationAccountId: null,
  categoryId: null,
  status: "confirmed",
  origin: "ticket",
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

function draftReadyScan(): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: "scan-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/scan-1.jpg",
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    fileHash: "a".repeat(64),
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  scan.value.markDraftReady({ raw: true }, DRAFT, new Date("2026-11-10T12:05:00.000Z"));
  return scan.value;
}

function confirmedScan(transactionId = "trx-1"): ReceiptScan {
  const scan = draftReadyScan();
  scan.markConfirmed(transactionId, new Date("2026-11-10T12:10:00.000Z"));
  return scan;
}

interface Deps {
  scans: ReceiptScanRepositoryPort;
  transactions: Pick<TransactionRepositoryPort, "findById">;
  recordManual: Pick<RecordManualTransactionUseCase, "execute">;
  createCategory: Pick<CreateCategoryUseCase, "execute">;
  catalog: CategoryCatalogPort;
  systemCategories: SystemCategoryPort;
}

function buildDeps(overrides: Partial<Deps> = {}) {
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => draftReadyScan()),
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
      { id: "cat-food", key: "food", label: "Comida", nature: "essential", custom: true },
      { id: "cat-mascotas", key: "mascotas", label: "Mascotas", nature: "discretionary", custom: true },
    ]),
  };
  const systemCategories: SystemCategoryPort = {
    ensureUncategorized: vi.fn(async () => UNCATEGORIZED_VIEW),
  };
  const deps: Deps = {
    scans,
    transactions,
    recordManual,
    createCategory,
    catalog,
    systemCategories,
    ...overrides,
  };
  const useCase = new ConfirmReceiptDraftUseCase(
    deps.scans,
    deps.transactions,
    deps.recordManual,
    deps.createCategory,
    deps.catalog,
    deps.systemCategories,
    clock,
  );
  return { useCase, deps };
}

function command(overrides: Partial<ConfirmReceiptDraftCommand> = {}): ConfirmReceiptDraftCommand {
  return {
    workspaceId: WS_A,
    receiptId: "scan-1",
    accountId: "acc-1",
    type: "expense",
    idempotencyKey: "confirm-scan-1",
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

function reconstitutedTransaction(id: string, idempotencyKey: string): Transaction {
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
    concept: "Bodega Central",
    accountId: "acc-1",
    destinationAccountId: null,
    category: categorized("cat-food"),
    status: "confirmed",
    origin: "ticket",
    originReference: "scan-1",
    confirmedAt: NOW,
    confirmedBy: "user-1",
    revisions: [],
    splits: [],
  });
}

describe("ConfirmReceiptDraftUseCase — draft approval (T6, S2+S4+S7+S10)", () => {
  it("records the transaction with splits, amount derived from their sum, origin ticket", async () => {
    const { useCase, deps } = buildDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction).toEqual(TX_VIEW);
    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent).toMatchObject({
      workspaceId: WS_A,
      idempotencyKey: "confirm-scan-1",
      type: "expense",
      amount: "35.50",
      currency: "PEN",
      businessDate: "2026-11-10",
      timezone: "America/Lima",
      concept: "Bodega Central",
      accountId: "acc-1",
      origin: "ticket",
      originReference: "scan-1",
      actor: "user-1",
      splits: [
        { categoryId: "cat-food", amount: 2000 },
        { categoryId: "cat-new", amount: 1000 },
        { categoryId: "sys-uncat", amount: 550 },
      ],
    });
  });

  it("creates each newCategory via the catalog use case and reports it (S10)", async () => {
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

  it("marks the scan confirmed and links the transaction", async () => {
    const scan = draftReadyScan();
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const { useCase, deps } = buildDeps({ scans });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    expect(scan.status).toBe("confirmed");
    expect(scan.transactionId).toBe("trx-1");
    expect(deps.scans.save).toHaveBeenCalledWith(scan);
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
    expect(sent.concept).toBe("Bodega Central");
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

  it("falls back to the workspace default currency when the draft lacks one", async () => {
    const scan = draftReadyScan();
    // Force a draft without currency/businessDate.
    const draftless = { ...DRAFT, currency: null, businessDate: null };
    scan.markDraftReady({ raw: true }, draftless, new Date("2026-11-10T12:06:00.000Z"));
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const { useCase, deps } = buildDeps({ scans });

    await useCase.execute(command());

    const sent = vi.mocked(deps.recordManual.execute).mock.calls[0]![0];
    expect(sent.currency).toBe("PEN");
    expect(sent.businessDate).toBe("2026-11-10"); // clock date in the workspace timezone
  });

  it("rejects with RECEIPT_NOT_READY when the scan is not draft_ready", async () => {
    const pending = ReceiptScan.quarantine({
      id: "scan-1",
      workspaceId: WS_A,
      uploaderSubject: "user-1",
      storageKey: "k",
      originalFilename: "t.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10,
      fileHash: "a".repeat(64),
      now: NOW,
    });
    if (!pending.ok) throw pending.error;
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => pending.value),
    };
    const { useCase, deps } = buildDeps({ scans });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_READY");
    }
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
    expect(deps.scans.save).not.toHaveBeenCalled();
  });

  it("rejects with RECEIPT_NOT_FOUND for a missing or foreign scan", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const { useCase } = buildDeps({ scans });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
  });

  it("rejects empty splits with RECEIPT_SPLITS_REQUIRED", async () => {
    const { useCase } = buildDeps();

    const result = await useCase.execute(command({ splits: [] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_SPLITS_REQUIRED");
    }
  });

  it("propagates a category creation failure without saving the scan", async () => {
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
    expect(deps.scans.save).not.toHaveBeenCalled();
  });

  it("propagates a recordManual failure and keeps the scan draft_ready", async () => {
    const scan = draftReadyScan();
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const recordManual = {
      execute: vi.fn(async () =>
        err(new DomainError("ACCOUNT_CURRENCY_MISMATCH", "mismatch")),
      ),
    };
    const { useCase, deps } = buildDeps({ scans, recordManual });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACCOUNT_CURRENCY_MISMATCH");
    }
    expect(scan.status).toBe("draft_ready");
    expect(deps.scans.save).not.toHaveBeenCalled();
  });

  it("returns the stored transaction on replay with the same idempotencyKey (no duplicates)", async () => {
    const scan = confirmedScan("trx-1");
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const stored = reconstitutedTransaction("trx-1", "confirm-scan-1");
    const transactions: Pick<TransactionRepositoryPort, "findById"> = {
      findById: vi.fn(async () => stored),
    };
    const { useCase, deps } = buildDeps({ scans, transactions });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction.id).toBe("trx-1");
    expect(result.value.createdCategories).toEqual([]);
    expect(deps.recordManual.execute).not.toHaveBeenCalled();
    expect(deps.createCategory.execute).not.toHaveBeenCalled();
    expect(deps.scans.save).not.toHaveBeenCalled();
  });

  it("rejects a replay on a confirmed scan when the idempotencyKey differs", async () => {
    const scan = confirmedScan("trx-1");
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const stored = reconstitutedTransaction("trx-1", "other-key");
    const transactions: Pick<TransactionRepositoryPort, "findById"> = {
      findById: vi.fn(async () => stored),
    };
    const { useCase } = buildDeps({ scans, transactions });

    const result = await useCase.execute(command());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_READY");
    }
  });
});
