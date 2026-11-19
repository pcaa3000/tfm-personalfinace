import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../ledger/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  ReceiptScan,
  type ReceiptScanStatus,
} from "../domain/receipt-scan.js";
import type { ReceiptScanDispatcher } from "./ports/receipt-scan-dispatcher.port.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import { RetryReceiptScanUseCase } from "./retry-receipt-scan.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const NOW = new Date("2026-11-10T13:00:00.000Z");
const clock: Clock = { now: () => NOW };

function scanWithStatus(status: ReceiptScanStatus): ReceiptScan {
  return ReceiptScan.reconstitute({
    id: "scan-1",
    workspaceId: "ws-a",
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/scan-1.jpg",
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    status,
    extractedPayload: null,
    draftPayload: null,
    transactionId: status === "confirmed" ? "trx-1" : null,
    error: status === "failed" ? "gemini exploded" : null,
    createdAt: new Date("2026-11-10T12:00:00.000Z"),
    updatedAt: new Date("2026-11-10T12:00:00.000Z"),
  });
}

function buildDeps(scan: ReceiptScan | null) {
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async () => undefined),
    findById: vi.fn(async () => scan),
  };
  const dispatcher: ReceiptScanDispatcher = {
    enqueueScan: vi.fn(async () => undefined),
  };
  return { scans, dispatcher };
}

describe("RetryReceiptScanUseCase — retry without re-upload (T12, S11)", () => {
  it("resets a failed scan to pending, clears the error and re-enqueues the same job", async () => {
    const scan = scanWithStatus("failed");
    const { scans, dispatcher } = buildDeps(scan);
    const useCase = new RetryReceiptScanUseCase(scans, dispatcher, clock);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("scan-1");
      expect(result.value.status).toBe("pending");
      expect(result.value.error).toBeNull();
    }
    expect(scan.status).toBe("pending");
    expect(scan.error).toBeNull();
    // The original quarantined object is reused — no new upload.
    expect(scan.storageKey).toBe("quarantine/ws-a/scan-1.jpg");
    expect(scans.save).toHaveBeenCalledWith(scan);
    expect(dispatcher.enqueueScan).toHaveBeenCalledWith("scan-1", "ws-a");
  });

  it.each(["pending", "extracted", "draft_ready"] as const)(
    "returns a scan still in flight or reviewable (%s) unchanged, without re-enqueueing",
    async (status) => {
      const scan = scanWithStatus(status);
      const { scans, dispatcher } = buildDeps(scan);
      const useCase = new RetryReceiptScanUseCase(scans, dispatcher, clock);

      const result = await useCase.execute(WS_A, "scan-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe(status);
      }
      expect(scan.status).toBe(status);
      expect(scans.save).not.toHaveBeenCalled();
      expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
    },
  );

  it.each(["confirmed", "rejected"] as const)(
    "rejects a user-final scan (%s) with RECEIPT_ALREADY_FINAL",
    async (status) => {
      const scan = scanWithStatus(status);
      const { scans, dispatcher } = buildDeps(scan);
      const useCase = new RetryReceiptScanUseCase(scans, dispatcher, clock);

      const result = await useCase.execute(WS_A, "scan-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RECEIPT_ALREADY_FINAL");
      }
      expect(scans.save).not.toHaveBeenCalled();
      expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
    },
  );

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND", async () => {
    const { scans, dispatcher } = buildDeps(null);
    const useCase = new RetryReceiptScanUseCase(scans, dispatcher, clock);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
    expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
  });
});
