import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptDraftPayload } from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type {
  TransactionDuplicateCriteria,
  TransactionDuplicatesPort,
} from "./ports/transaction-duplicates.port.js";
import { GetReceiptDraftUseCase } from "./get-receipt-draft.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const DRAFT: ReceiptDraftPayload = {
  merchant: "Bodega Central",
  concept: "Bodega Central",
  businessDate: "2026-11-10",
  currency: "PEN",
  totalMinorUnits: 2550,
  totalMismatch: false,
  splits: [
    {
      categoryKey: "food",
      newCategory: null,
      amountMinorUnits: 2000,
      itemCount: 2,
      confidenceAvg: 0.9,
      lowConfidence: false,
    },
    {
      categoryKey: null,
      newCategory: null,
      amountMinorUnits: 550,
      itemCount: 1,
      confidenceAvg: 0.4,
      lowConfidence: true,
    },
  ],
  items: [
    {
      description: "Arroz",
      amountMinorUnits: 1200,
      suggestedCategoryKey: "food",
      suggestedNewCategory: null,
      confidence: 0.9,
    },
    {
      description: "Atún",
      amountMinorUnits: 800,
      suggestedCategoryKey: "food",
      suggestedNewCategory: null,
      confidence: 0.9,
    },
    {
      description: "Item raro",
      amountMinorUnits: 550,
      suggestedCategoryKey: null,
      suggestedNewCategory: null,
      confidence: 0.4,
    },
  ],
};

function draftReadyScan(
  draft: ReceiptDraftPayload = DRAFT,
): ReceiptScan {
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
  scan.value.markDraftReady({ raw: true }, draft, new Date("2026-11-10T12:05:00.000Z"));
  return scan.value;
}

function makeDeps(
  scan: ReceiptScan | null,
  candidates: Awaited<
    ReturnType<TransactionDuplicatesPort["findExpenseCandidates"]>
  > = [],
) {
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(),
    findById: vi.fn(async () => scan),
  };
  const duplicates: TransactionDuplicatesPort = {
    findExpenseCandidates: vi.fn(
      async (_ws: WorkspaceId, _criteria: TransactionDuplicateCriteria) =>
        candidates,
    ),
  };
  return { useCase: new GetReceiptDraftUseCase(scans, duplicates), duplicates };
}

describe("GetReceiptDraftUseCase — draft review read (T6, S2+S7)", () => {
  it("returns the stored draft payload when the scan is draft_ready", async () => {
    const { useCase } = makeDeps(draftReadyScan());

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      // T13: possibleDuplicates is added at read time on top of the
      // stored payload (empty when nothing matches).
      expect(result.value).toEqual({
        ...DRAFT,
        possibleDuplicates: [],
      });
    }
  });

  it("rejects with RECEIPT_NOT_READY while the scan is still pending", async () => {
    const pending = ReceiptScan.quarantine({
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
    if (!pending.ok) throw pending.error;
    const { useCase } = makeDeps(pending.value);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_READY");
    }
  });

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND", async () => {
    const { useCase } = makeDeps(null);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
  });
});

describe("GetReceiptDraftUseCase — possibleDuplicates (T13, S12)", () => {
  it("queries expenses by draft total, ±3d window and merchant, echoing candidates", async () => {
    const { useCase, duplicates } = makeDeps(draftReadyScan(), [
      {
        transactionId: "trx-9",
        concept: "Bodega Central",
        amount: 2550,
        occurredOn: "2026-11-09",
      },
    ]);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(duplicates.findExpenseCandidates).toHaveBeenCalledWith(WS_A, {
      amountMinorUnits: 2550,
      fromDate: "2026-11-07",
      toDate: "2026-11-13",
      merchant: "Bodega Central",
    });
    expect(result.value.possibleDuplicates).toEqual([
      {
        transactionId: "trx-9",
        concept: "Bodega Central",
        amount: 2550,
        occurredOn: "2026-11-09",
      },
    ]);
  });

  it("falls back to merchant-only matching when the draft has no date", async () => {
    const { useCase, duplicates } = makeDeps(
      draftReadyScan({ ...DRAFT, businessDate: null }),
    );

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(duplicates.findExpenseCandidates).toHaveBeenCalledWith(WS_A, {
      amountMinorUnits: 2550,
      merchant: "Bodega Central",
    });
    expect(result.value.possibleDuplicates).toEqual([]);
  });

  it("falls back to the ±3d window alone when the draft has no merchant", async () => {
    const { useCase, duplicates } = makeDeps(
      draftReadyScan({ ...DRAFT, merchant: null }),
    );

    await useCase.execute(WS_A, "scan-1");

    expect(duplicates.findExpenseCandidates).toHaveBeenCalledWith(WS_A, {
      amountMinorUnits: 2550,
      fromDate: "2026-11-07",
      toDate: "2026-11-13",
    });
  });

  it("skips the lookup and returns an empty list when the draft has no total", async () => {
    const { useCase, duplicates } = makeDeps(
      draftReadyScan({ ...DRAFT, totalMinorUnits: null }),
    );

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.possibleDuplicates).toEqual([]);
    }
    expect(duplicates.findExpenseCandidates).not.toHaveBeenCalled();
  });

  it("skips the lookup when neither a date window nor a merchant exists", async () => {
    const { useCase, duplicates } = makeDeps(
      draftReadyScan({ ...DRAFT, businessDate: null, merchant: null }),
    );

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.possibleDuplicates).toEqual([]);
    }
    expect(duplicates.findExpenseCandidates).not.toHaveBeenCalled();
  });
});
