import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanListPort } from "./ports/receipt-scan-repository.port.js";
import { ListReceiptScansUseCase } from "./list-receipt-scans.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeScan(id: string): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id,
    workspaceId: ws,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-1/${id}.jpg`,
    originalFilename: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 100,
    fileHash: id.padEnd(64, "0").slice(0, 64),
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  return scan.value;
}

describe("ListReceiptScansUseCase (receipt-review-link T1, S1)", () => {
  it("returns the workspace scans as list items carrying the linked transaction id", async () => {
    const confirmed = makeScan("scan-confirmed");
    confirmed.markConfirmed("trx-9", new Date("2026-11-10T12:05:00.000Z"));
    const scans: ReceiptScanListPort = {
      listByWorkspace: vi.fn(async () => [
        makeScan("scan-pending"),
        confirmed,
      ]),
    };
    const useCase = new ListReceiptScansUseCase(scans);

    const items = await useCase.execute(ws);

    expect(vi.mocked(scans.listByWorkspace)).toHaveBeenCalledWith(ws);
    expect(items).toEqual([
      {
        id: "scan-pending",
        status: "pending",
        originalFilename: "scan-pending.jpg",
        fileMimeType: "image/jpeg",
        createdAt: "2026-11-10T12:00:00.000Z",
        transactionId: null,
        // receipt-retention-30d T1 (S2): fixed capture + 30d, live media.
        expiresAt: "2026-12-10T12:00:00.000Z",
        mediaDeletedAt: null,
      },
      {
        id: "scan-confirmed",
        status: "confirmed",
        originalFilename: "scan-confirmed.jpg",
        fileMimeType: "image/jpeg",
        createdAt: "2026-11-10T12:00:00.000Z",
        transactionId: "trx-9",
        expiresAt: "2026-12-10T12:00:00.000Z",
        mediaDeletedAt: null,
      },
    ]);
  });
});
