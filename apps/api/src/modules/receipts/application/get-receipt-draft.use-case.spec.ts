import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptDraftPayload } from "../domain/receipt-draft.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
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

function draftReadyScan(): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: "scan-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/scan-1.jpg",
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  scan.value.markDraftReady({ raw: true }, DRAFT, new Date("2026-11-10T12:05:00.000Z"));
  return scan.value;
}

describe("GetReceiptDraftUseCase — draft review read (T6, S2+S7)", () => {
  it("returns the stored draft payload when the scan is draft_ready", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => draftReadyScan()),
    };
    const useCase = new GetReceiptDraftUseCase(scans);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DRAFT);
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
      now: new Date("2026-11-10T12:00:00.000Z"),
    });
    if (!pending.ok) throw pending.error;
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => pending.value),
    };
    const useCase = new GetReceiptDraftUseCase(scans);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_READY");
    }
  });

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => null),
    };
    const useCase = new GetReceiptDraftUseCase(scans);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
  });
});
