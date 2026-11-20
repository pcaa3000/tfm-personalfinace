import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanListPort } from "./ports/receipt-scan-repository.port.js";
import { decodeReceiptScanCursor } from "./receipt-scan-cursor.js";
import { ListReceiptScansUseCase } from "./list-receipt-scans.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("setup failed");
const ws = wsResult.value;

function makeScan(
  id: string,
  createdAt = "2026-11-10T12:00:00.000Z",
): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id,
    workspaceId: ws,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-1/${id}.jpg`,
    originalFilename: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 100,
    fileHash: id.padEnd(64, "0").slice(0, 64),
    now: new Date(createdAt),
  });
  if (!scan.ok) throw scan.error;
  return scan.value;
}

describe("ListReceiptScansUseCase (receipt-review-link T1, S1; T5, S4)", () => {
  it("returns the page scans as list items carrying the linked transaction id", async () => {
    const confirmed = makeScan("scan-confirmed");
    confirmed.markConfirmed("trx-9", new Date("2026-11-10T12:05:00.000Z"));
    const scans: ReceiptScanListPort = {
      listByWorkspace: vi.fn(async () => ({
        scans: [makeScan("scan-pending"), confirmed],
        hasMore: false,
      })),
    };
    const useCase = new ListReceiptScansUseCase(scans);

    const page = await useCase.execute(ws, { limit: 50 });

    expect(vi.mocked(scans.listByWorkspace)).toHaveBeenCalledWith(ws, {
      limit: 50,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
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

  it("emits an opaque nextCursor for the last item while the page hasMore (T5, S4)", async () => {
    const scans: ReceiptScanListPort = {
      listByWorkspace: vi.fn(async () => ({
        scans: [
          makeScan("scan-newer", "2026-11-10T13:00:00.000Z"),
          makeScan("scan-older", "2026-11-10T12:00:00.000Z"),
        ],
        hasMore: true,
      })),
    };
    const useCase = new ListReceiptScansUseCase(scans);

    const page = await useCase.execute(ws, { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(typeof page.nextCursor).toBe("string");
    // The token is the keyset position of the LAST item — decoding it
    // (same codec the route uses to read cursors) must yield that row.
    expect(decodeReceiptScanCursor(page.nextCursor!)).toEqual({
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
      id: "scan-older",
    });
  });

  it("forwards the after cursor to the port untouched (T5, S4)", async () => {
    const after = {
      createdAt: new Date("2026-11-09T08:00:00.000Z"),
      id: "scan-anchor",
    };
    const scans: ReceiptScanListPort = {
      listByWorkspace: vi.fn(async () => ({ scans: [], hasMore: false })),
    };
    const useCase = new ListReceiptScansUseCase(scans);

    const page = await useCase.execute(ws, { limit: 10, after });

    expect(vi.mocked(scans.listByWorkspace)).toHaveBeenCalledWith(ws, {
      limit: 10,
      after,
    });
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
