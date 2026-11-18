import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptScanDispatcher } from "./ports/receipt-scan-dispatcher.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import {
  UploadReceiptUseCase,
  type UploadReceiptCommand,
} from "./upload-receipt.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const FAKE_JPEG = new TextEncoder().encode("not a real jpeg");
const NOW = new Date("2026-11-10T12:00:00.000Z");

function makeDeps() {
  const saved: ReceiptScan[] = [];
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
  };
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async (scan: ReceiptScan) => {
      saved.push(scan);
    }),
    findById: vi.fn(async () => null),
  };
  const dispatcher: ReceiptScanDispatcher = {
    enqueueScan: vi.fn(async () => undefined),
  };
  const useCase = new UploadReceiptUseCase(storage, scans, dispatcher, {
    now: () => NOW,
  }, { next: () => "scan-id-1" }, { maxBytes: 1024 });
  return { useCase, storage, scans, dispatcher, saved };
}

function command(overrides: Partial<UploadReceiptCommand> = {}): UploadReceiptCommand {
  return {
    workspaceId: WS,
    uploaderSubject: "user-1",
    originalFilename: "ticket.jpg",
    bytes: JPEG,
    ...overrides,
  };
}

describe("UploadReceiptUseCase — quarantine gate (receipt-scan-drafts T3, S1+S9)", () => {
  it("stores the bytes, persists a pending scan row and enqueues receipt-scan", async () => {
    const { useCase, storage, scans, dispatcher, saved } = makeDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.value;
    expect(view.id).toBe("scan-id-1");
    expect(view.workspaceId).toBe("ws-1");
    expect(view.status).toBe("pending");
    expect(view.mimeType).toBe("image/jpeg");
    expect(view.sizeBytes).toBe(JPEG.byteLength);
    expect(view.originalFilename).toBe("ticket.jpg");

    // Bytes persisted under a quarantine key derived from the sniffed mime,
    // not from the client-supplied extension.
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringMatching(/^quarantine\/ws-1\/scan-id-1\.jpg$/),
      JPEG,
      "image/jpeg",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.status).toBe("pending");
    expect(saved[0]!.storageKey).toBe("quarantine/ws-1/scan-id-1.jpg");
    // Minimal job payload for the T4 worker handler — the workspace id
    // scopes the worker's repository lookup (T4+T5).
    expect(dispatcher.enqueueScan).toHaveBeenCalledWith("scan-id-1", "ws-1");
    expect(scans.save).toHaveBeenCalled();
  });

  it("rejects a fake .jpg by magic bytes BEFORE touching storage (RECEIPT_TYPE_NOT_ALLOWED)", async () => {
    const { useCase, storage, scans, dispatcher } = makeDeps();

    const result = await useCase.execute(command({ bytes: FAKE_JPEG }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_TYPE_NOT_ALLOWED");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
  });

  it("rejects an empty upload with RECEIPT_EMPTY before storing", async () => {
    const { useCase, storage, scans, dispatcher } = makeDeps();

    const result = await useCase.execute(
      command({ bytes: new Uint8Array(0) }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_EMPTY");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
  });

  it("rejects bytes over the limit with RECEIPT_TOO_LARGE before storing", async () => {
    const { useCase, storage, scans, dispatcher } = makeDeps();
    const big = new Uint8Array(1025);
    big.set(JPEG.slice(0, 4));

    const result = await useCase.execute(command({ bytes: big }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_TOO_LARGE");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
  });

  it("extension in the storage key follows the sniffed mime, not the filename", async () => {
    const { useCase, storage } = makeDeps();

    const result = await useCase.execute(
      command({ originalFilename: "evaded.png" }),
    );

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      expect.stringMatching(/\.jpg$/),
      JPEG,
      "image/jpeg",
    );
  });

  it("a dispatcher failure does not fail the upload — the pending row is the source of truth", async () => {
    const { useCase, dispatcher } = makeDeps();
    vi.mocked(dispatcher.enqueueScan).mockRejectedValueOnce(
      new Error("pg-boss down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
    }
    errorSpy.mockRestore();
  });
});
