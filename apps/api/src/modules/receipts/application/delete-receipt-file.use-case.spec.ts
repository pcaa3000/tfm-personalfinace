import { describe, expect, it, vi } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import { DeleteReceiptFileUseCase } from "./delete-receipt-file.use-case.js";

const wsA = WorkspaceId.create("ws-a");
if (!wsA.ok) throw new Error("workspace setup failed");
const WS_A = wsA.value;
const wsB = WorkspaceId.create("ws-b");
if (!wsB.ok) throw new Error("workspace setup failed");
const WS_B = wsB.value;

const NOW = new Date("2026-11-10T12:00:00.000Z");
const DELETE_AT = new Date("2026-11-15T09:00:00.000Z");

function makeScan(overrides: Partial<{
  id: string;
  confirmed: boolean;
}> = {}): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: overrides.id ?? "scan-1",
    workspaceId: WS_A,
    uploaderSubject: "user-1",
    storageKey: `quarantine/ws-a/${overrides.id ?? "scan-1"}.jpg`,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    fileHash: "a".repeat(64),
    now: NOW,
  });
  if (!scan.ok) throw scan.error;
  if (overrides.confirmed) {
    scan.value.markConfirmed("trx-1", NOW);
  }
  return scan.value;
}

function makeDeps(scan: ReceiptScan | null) {
  const saved: ReceiptScan[] = [];
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  const scans: ReceiptScanRepositoryPort = {
    save: vi.fn(async (s: ReceiptScan) => {
      saved.push(s);
    }),
    findById: vi.fn(async () => scan),
  };
  const clock = { now: () => DELETE_AT };
  const useCase = new DeleteReceiptFileUseCase(scans, storage, clock);
  return { useCase, storage, scans, saved };
}

describe("DeleteReceiptFileUseCase — early media deletion (receipt-retention-30d T3, S3, CA-012)", () => {
  it("deletes ONLY the storage object and stamps mediaDeletedAt — the scan row survives", async () => {
    const scan = makeScan();
    const { useCase, storage, scans, saved } = makeDeps(scan);

    const result = await useCase.execute(WS_A, "scan-1");

    expect(result.ok).toBe(true);
    expect(storage.delete).toHaveBeenCalledWith(
      "quarantine/ws-a/scan-1.jpg",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(scan);
    expect(scan.mediaDeletedAt).toEqual(DELETE_AT);
    // CA-012: the row and its status/transaction link are untouched.
    expect(scan.status).toBe("pending");
    if (result.ok) {
      expect(result.value.mediaDeletedAt).toBe(DELETE_AT.toISOString());
      expect(result.value.status).toBe("pending");
    }
    expect(scans.save).toHaveBeenCalledWith(scan);
  });

  it("works on a confirmed scan — the linked transaction is untouched (CA-012)", async () => {
    const scan = makeScan({ id: "scan-confirmed", confirmed: true });
    const { useCase } = makeDeps(scan);

    const result = await useCase.execute(WS_A, "scan-confirmed");

    expect(result.ok).toBe(true);
    expect(scan.status).toBe("confirmed");
    expect(scan.transactionId).toBe("trx-1");
    expect(scan.mediaDeletedAt).toEqual(DELETE_AT);
  });

  it("is idempotent: deleting already-deleted media still succeeds and keeps the first timestamp", async () => {
    const scan = makeScan();
    const { useCase, storage, scans } = makeDeps(scan);

    await useCase.execute(WS_A, "scan-1");
    const later = new Date("2026-11-20T09:00:00.000Z");
    const useCase2 = new DeleteReceiptFileUseCase(scans, storage, {
      now: () => later,
    });
    const second = await useCase2.execute(WS_A, "scan-1");

    expect(second.ok).toBe(true);
    // Storage delete is re-issued (tolerates ENOENT/404) but the audit
    // timestamp stays the original one and no extra save is needed.
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(scan.mediaDeletedAt).toEqual(DELETE_AT);
  });

  it("maps a missing or foreign-workspace scan to RECEIPT_NOT_FOUND without touching storage", async () => {
    const { useCase, storage, scans } = makeDeps(null);

    const result = await useCase.execute(WS_B, "scan-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECEIPT_NOT_FOUND");
    }
    expect(storage.delete).not.toHaveBeenCalled();
    expect(scans.save).not.toHaveBeenCalled();
  });
});
