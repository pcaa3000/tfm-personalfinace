import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inputFixture, viewFixture } from "./fixtures";
import {
  enqueueTransaction,
  ledgerDb,
  listPendingTransactions,
} from "./queue";
import { syncPendingTransactions } from "./sync";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  await ledgerDb.pendingTransactions.clear();
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

function okResponse(): Response {
  return new Response(JSON.stringify(viewFixture()), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

describe("syncPendingTransactions", () => {
  it("drains the queue posting each item once", async () => {
    await enqueueTransaction(inputFixture({ idempotencyKey: "key-1" }));
    await enqueueTransaction(inputFixture({ idempotencyKey: "key-2" }));
    fetchMock.mockResolvedValue(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 2, remaining: 0 });
    expect(await listPendingTransactions()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)) as {
        idempotencyKey: string;
      },
    );
    expect(bodies.map((b) => b.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });

  it("keeps items queued when the network is down and counts attempts", async () => {
    await enqueueTransaction(inputFixture());
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 0, remaining: 1 });
    const [item] = await listPendingTransactions();
    expect(item?.attempts).toBe(1);
    expect(item?.lastError).toContain("fetch failed");
  });

  it("syncs what it can and keeps the rest for the next run", async () => {
    await enqueueTransaction(inputFixture({ idempotencyKey: "stuck" }));
    await enqueueTransaction(inputFixture({ idempotencyKey: "fine" }));
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 1, remaining: 1 });
    const [item] = await listPendingTransactions();
    expect(item?.idempotencyKey).toBe("stuck");
  });

  it("retries a previously failed item on the next run", async () => {
    const input = inputFixture({ idempotencyKey: "retry-me" });
    await enqueueTransaction(input);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await syncPendingTransactions();

    fetchMock.mockResolvedValueOnce(okResponse());
    const result = await syncPendingTransactions();

    expect(result.synced).toBe(1);
    expect(await listPendingTransactions()).toHaveLength(0);
  });
});
