import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../ledger/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { RejectReceiptScanUseCase } from "./reject-receipt-scan.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");
const clock: Clock = { now: () => NOW };

function pendingScan(): ReceiptScan {
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
  return scan.value;
}

describe("RejectReceiptScanUseCase — user discard (T6, S2)", () => {
  it("marks a non-terminal scan rejected and persists it", async () => {
    const scan = pendingScan();
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => scan),
    };
    const useCase = new RejectReceiptScanUseCase(scans, clock);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("rejected");
    }
    expect(scan.status).toBe("rejected");
    expect(scans.save).toHaveBeenCalledWith(scan);
  });

  it.each(["confirmed", "rejected", "failed"] as const)(
    "rejects a terminal scan (%s) with RECEIPT_ALREADY_FINAL",
    async (status) => {
      const scan = pendingScan();
      if (status === "confirmed") {
        scan.markConfirmed("trx-1", NOW);
      } else if (status === "rejected") {
        scan.markRejected(NOW);
      } else {
        scan.markFailed("boom", NOW);
      }
      const scans: ReceiptScanRepositoryPort = {
        save: vi.fn(async () => undefined),
        findById: vi.fn(async () => scan),
      };
      const useCase = new RejectReceiptScanUseCase(scans, clock);

      const result = await useCase.execute(WS_A, "scan-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RECEIPT_ALREADY_FINAL");
      }
      expect(scans.save).not.toHaveBeenCalled();
    },
  );

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND", async () => {
    const scans: ReceiptScanRepositoryPort = {
      save: vi.fn(async () => undefined),
      findById: vi.fn(async () => null),
    };
    const useCase = new RejectReceiptScanUseCase(scans, clock);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
  });
});
