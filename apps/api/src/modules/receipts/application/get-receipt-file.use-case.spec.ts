import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import { GetReceiptFileUseCase } from "./get-receipt-file.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function makeScan(mediaDeleted = false): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: "scan-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-a/scan-1.jpg",
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: JPEG.byteLength,
    fileHash: "a".repeat(64),
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  if (mediaDeleted) {
    scan.value.markMediaDeleted(new Date("2026-11-20T12:00:00.000Z"));
  }
  return scan.value;
}

function makeDeps(scan: ReceiptScan | null, bytes: Uint8Array | null = JPEG) {
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => bytes),
    delete: vi.fn(async () => undefined),
  };
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(),
    findById: vi.fn(async () => scan),
  };
  return { useCase: new GetReceiptFileUseCase(scans, storage), storage };
}

describe("GetReceiptFileUseCase — media retention (receipt-retention-30d T3, S3)", () => {
  it("streams the stored bytes while media exists", async () => {
    const { useCase } = makeDeps(makeScan());

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bytes).toEqual(JPEG);
      expect(result.value.mimeType).toBe("image/jpeg");
    }
  });

  it("returns RECEIPT_MEDIA_DELETED when the medium was purged — never reads storage", async () => {
    const { useCase, storage } = makeDeps(makeScan(true));

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Distinct from RECEIPT_NOT_FOUND (404): the route maps it to 410
      // so the web can tell "media gone" apart from "scan not found".
      expect(result.error.code).toBe("RECEIPT_MEDIA_DELETED");
    }
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("returns RECEIPT_MEDIA_DELETED when the stored object is missing (drift also reads as media gone)", async () => {
    const { useCase } = makeDeps(makeScan(), null);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_MEDIA_DELETED");
    }
  });
});
