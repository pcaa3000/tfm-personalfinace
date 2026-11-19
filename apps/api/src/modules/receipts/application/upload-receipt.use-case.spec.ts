import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { FileHasherPort } from "./ports/file-hasher.port.js";
import type { ReceiptFileHashPort } from "./ports/receipt-file-hash.port.js";
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
/** Same JPEG signature, different content — a different file hash. */
const JPEG_2 = Uint8Array.from([...JPEG, 0xaa, 0xbb]);
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
  const fileHashes: ReceiptFileHashPort = {
    findByFileHash: vi.fn(async () => null),
  };
  // Deterministic content-derived hash — identical bytes collide like a
  // real SHA-256; the production adapter is CryptoFileHasher (infra).
  const hasher: FileHasherPort = {
    sha256Hex: vi.fn(
      (bytes: Uint8Array) =>
        `hash-${bytes.byteLength}-${bytes[bytes.byteLength - 1] ?? 0}`,
    ),
  };
  const dispatcher: ReceiptScanDispatcher = {
    enqueueScan: vi.fn(async () => undefined),
  };
  const useCase = new UploadReceiptUseCase(
    storage,
    scans,
    fileHashes,
    hasher,
    dispatcher,
    { now: () => NOW },
    { next: () => "scan-id-1" },
    { maxBytes: 1024 },
  );
  return { useCase, storage, scans, fileHashes, hasher, dispatcher, saved };
}

/** A stored scan as the dedup lookup would return it. */
function storedScan(overrides: Partial<{
  id: string;
  status: "pending" | "failed" | "rejected";
}> = {}): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: overrides.id ?? "scan-existing",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-1/${overrides.id ?? "scan-existing"}.jpg`,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: JPEG.byteLength,
    fileHash: "hash-12-1",
    now: NOW,
  });
  if (!scan.ok) throw scan.error;
  if (overrides.status === "failed") {
    scan.value.markFailed("pipeline blew up", NOW);
  }
  if (overrides.status === "rejected") {
    scan.value.markRejected(NOW);
  }
  return scan.value;
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

describe("UploadReceiptUseCase — exact-hash dedup (T13, S12)", () => {
  it("hashes the uploaded bytes and stores fileHash on the new row", async () => {
    const { useCase, hasher, fileHashes, saved } = makeDeps();

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    // The hash is computed over the same bytes handed to storage.
    expect(hasher.sha256Hex).toHaveBeenCalledWith(JPEG);
    expect(fileHashes.findByFileHash).toHaveBeenCalledWith(
      WS,
      "hash-12-1",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.fileHash).toBe("hash-12-1");
  });

  it("returns the existing scan for identical bytes — no second file, row or job", async () => {
    const { useCase, storage, scans, fileHashes, dispatcher, saved } =
      makeDeps();
    const first = await useCase.execute(command());
    // The second upload finds what the first persisted.
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(
      saved[0] ?? null,
    );
    const second = await useCase.execute(command());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id);
      expect(second.value.status).toBe(first.value.status);
    }
    // Idempotent: one stored object, one row, one enqueued job.
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(scans.save).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueScan).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it("still returns the existing scan when it is failed — retry owns re-enqueue", async () => {
    const { useCase, storage, scans, fileHashes, dispatcher } = makeDeps();
    const failed = storedScan({ id: "scan-failed", status: "failed" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(failed);

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("scan-failed");
      expect(result.value.status).toBe("failed");
    }
    expect(storage.save).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
    expect(dispatcher.enqueueScan).not.toHaveBeenCalled();
  });

  it("a rejected dedup hit is reused: pending + re-enqueued over the original storageKey (R4-DEDUP-FINAL-STATUS)", async () => {
    const { useCase, storage, scans, fileHashes, dispatcher } = makeDeps();
    const rejected = storedScan({ id: "scan-rej", status: "rejected" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(rejected);

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("scan-rej");
      expect(result.value.status).toBe("pending");
    }
    expect(rejected.status).toBe("pending");
    expect(scans.save).toHaveBeenCalledWith(rejected);
    expect(dispatcher.enqueueScan).toHaveBeenCalledWith(
      "scan-rej",
      WS.value,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("a rejected dedup hit whose re-enqueue fails is marked failed — never stuck pending (R4-RETRY-LOST-JOB)", async () => {
    const { useCase, scans, fileHashes, dispatcher } = makeDeps();
    const rejected = storedScan({ id: "scan-rej2", status: "rejected" });
    vi.mocked(fileHashes.findByFileHash).mockResolvedValueOnce(rejected);
    vi.mocked(dispatcher.enqueueScan).mockRejectedValueOnce(new Error("boss down"));

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("failed");
    }
    expect(rejected.status).toBe("failed");
    expect(scans.save).toHaveBeenCalledTimes(2);
  });

  it("a second upload of DIFFERENT bytes stores a fresh scan", async () => {
    const { useCase, storage, saved } = makeDeps();

    const first = await useCase.execute(command());
    const second = await useCase.execute(command({ bytes: JPEG_2 }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.fileHash).not.toBe(saved[0]!.fileHash);
  });

  it("treats a unique-index race as a dedup hit — re-reads and returns the winner", async () => {
    const { useCase, scans, fileHashes } = makeDeps();
    // Concurrent identical upload: the lookup missed, the insert hit the
    // UNIQUE(workspaceId, fileHash) constraint, the winner now exists.
    const winner = storedScan({ id: "scan-winner" });
    vi.mocked(fileHashes.findByFileHash)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    vi.mocked(scans.save).mockRejectedValueOnce(
      Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint_name: "receipts_receipt_scans_workspaceId_fileHash_key",
      }),
    );

    const result = await useCase.execute(command());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("scan-winner");
    }
    expect(fileHashes.findByFileHash).toHaveBeenCalledTimes(2);
  });
});
