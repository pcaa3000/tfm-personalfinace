import { describe, expect, it, vi } from "vitest";

import type { Clock } from "../../ledger/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import type { ReceiptMediaPurgePort } from "./ports/receipt-scan-repository.port.js";
import type { ReceiptStoragePort } from "./ports/receipt-storage.port.js";
import {
  PurgeReceiptMediaUseCase,
  RECEIPT_MANUAL_PURGE_BATCH_SIZE,
} from "./purge-receipt-media.use-case.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const clock: Clock = { now: () => NOW };

function candidate(id: string) {
  return { id, storageKey: `quarantine/ws-1/${id}.jpg` };
}

function makeDeps(candidates: ReturnType<typeof candidate>[]) {
  const scans: ReceiptMediaPurgePort = {
    listMediaPurgeCandidates: vi.fn(async () => candidates),
    stampMediaDeleted: vi.fn(async () => undefined),
  };
  const storage: ReceiptStoragePort = {
    save: vi.fn(async (key: string) => key),
    open: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  return { scans, storage };
}

describe("PurgeReceiptMediaUseCase (receipt-retention-30d T6, S6)", () => {
  it("deletes the stored object of every live-media scan at/before the cutoff, stamps each row, and returns the count", async () => {
    const { scans, storage } = makeDeps([candidate("a"), candidate("b")]);
    const useCase = new PurgeReceiptMediaUseCase(scans, storage, clock);

    const deleted = await useCase.execute(WS, 7);

    expect(deleted).toBe(2);
    // S6: the cutoff is by CAPTURE AGE — createdAt <= now - window —
    // NOT expiresAt (that predicate belongs to the daily cron job).
    expect(scans.listMediaPurgeCandidates).toHaveBeenCalledWith(
      WS,
      new Date(NOW.getTime() - 7 * DAY),
      RECEIPT_MANUAL_PURGE_BATCH_SIZE,
    );
    expect(vi.mocked(storage.delete).mock.calls.map(([k]) => k)).toEqual([
      "quarantine/ws-1/a.jpg",
      "quarantine/ws-1/b.jpg",
    ]);
    expect(scans.stampMediaDeleted).toHaveBeenCalledWith("a", NOW);
    expect(scans.stampMediaDeleted).toHaveBeenCalledWith("b", NOW);
  });

  it.each([[15], [30]] as const)(
    "computes the cutoff as now - %d days",
    async (olderThanDays) => {
      const { scans, storage } = makeDeps([]);
      const useCase = new PurgeReceiptMediaUseCase(scans, storage, clock);

      await useCase.execute(WS, olderThanDays);

      expect(scans.listMediaPurgeCandidates).toHaveBeenCalledWith(
        WS,
        new Date(NOW.getTime() - olderThanDays * DAY),
        RECEIPT_MANUAL_PURGE_BATCH_SIZE,
      );
    },
  );

  it("isolates a per-item storage failure: the row stays unstamped and the batch continues", async () => {
    const { scans, storage } = makeDeps([
      candidate("a"),
      candidate("b"),
      candidate("c"),
    ]);
    vi.mocked(storage.delete).mockImplementation(async (key) => {
      if (key === "quarantine/ws-1/b.jpg") throw new Error("storage down");
    });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const useCase = new PurgeReceiptMediaUseCase(scans, storage, clock);

    const deleted = await useCase.execute(WS, 30);

    // Only actual deletions count; the failed row is left for a retry.
    expect(deleted).toBe(2);
    expect(scans.stampMediaDeleted).toHaveBeenCalledWith("a", NOW);
    expect(scans.stampMediaDeleted).not.toHaveBeenCalledWith(
      "b",
      expect.anything(),
    );
    expect(scans.stampMediaDeleted).toHaveBeenCalledWith("c", NOW);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns 0 when nothing qualifies", async () => {
    const { scans, storage } = makeDeps([]);
    const useCase = new PurgeReceiptMediaUseCase(scans, storage, clock);

    const deleted = await useCase.execute(WS, 30);

    expect(deleted).toBe(0);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(scans.stampMediaDeleted).not.toHaveBeenCalled();
  });
});
