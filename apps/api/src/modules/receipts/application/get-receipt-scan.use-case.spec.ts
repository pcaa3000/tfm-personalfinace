import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { GetReceiptScanUseCase } from "./get-receipt-scan.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;
const wsB = WorkspaceId.create("ws-b");
if (!wsB.ok) throw new Error("workspace setup failed");
const WS_B = wsB.value;

function pendingScan(): ReceiptScan {
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
  return scan.value;
}

describe("GetReceiptScanUseCase — polling read (T3)", () => {
  it("returns the scan view for the owning workspace", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => pendingScan()),
    };
    const useCase = new GetReceiptScanUseCase(scans);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("scan-1");
      expect(result.value.status).toBe("pending");
      expect(result.value.originalFilename).toBe("ticket.jpg");
    }
    expect(scans.findById).toHaveBeenCalledWith(WS_A, "scan-1");
  });

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(),
      findById: vi.fn(async () => null),
    };
    const useCase = new GetReceiptScanUseCase(scans);

    const result = await useCase.execute(WS_B, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
  });
});
