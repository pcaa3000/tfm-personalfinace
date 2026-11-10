import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessTokenProvider } from "../api";
import { inputFixture, jwtFixture, viewFixture } from "./fixtures";
import {
  enqueueTransaction,
  ledgerDb,
  listPendingTransactions,
} from "./queue";
import { syncPendingTransactions } from "./sync";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  setAccessTokenProvider(null);
  await ledgerDb.pendingTransactions.clear();
  fetchMock.mockReset();
});

afterEach(() => {
  setAccessTokenProvider(null);
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

    expect(result).toEqual({ synced: 2, dropped: 0, remaining: 0 });
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

    expect(result).toEqual({ synced: 0, dropped: 0, remaining: 1 });
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

    expect(result).toEqual({ synced: 1, dropped: 0, remaining: 1 });
    const [item] = await listPendingTransactions();
    expect(item?.idempotencyKey).toBe("stuck");
  });

  // GAP-SEC-08 (S6): an item stamped under another identity must never
  // be sent with the current token — it is dropped instead of drained.
  it("drops items bound to another identity without sending them", async () => {
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    await enqueueTransaction(inputFixture({ idempotencyKey: "foreign" }));
    setAccessTokenProvider(async () => jwtFixture("user-b"));
    fetchMock.mockResolvedValue(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 0, dropped: 1, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listPendingTransactions()).toHaveLength(0);
  });

  it("drops bypass-era items once a real identity signs in", async () => {
    // Enqueued under dev bypass (no provider → null subject), then a
    // real session appears: the item belongs to no current identity.
    await enqueueTransaction(inputFixture({ idempotencyKey: "bypass-era" }));
    setAccessTokenProvider(async () => jwtFixture("user-b"));
    fetchMock.mockResolvedValue(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 0, dropped: 1, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drains own items while dropping foreign ones", async () => {
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    await enqueueTransaction(inputFixture({ idempotencyKey: "mine" }));
    setAccessTokenProvider(async () => jwtFixture("user-b"));
    await enqueueTransaction(inputFixture({ idempotencyKey: "theirs" }));
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    fetchMock.mockResolvedValue(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 1, dropped: 1, remaining: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as { idempotencyKey: string };
    expect(body.idempotencyKey).toBe("mine");
    expect(await listPendingTransactions()).toHaveLength(0);
  });

  it("retains items when the caller subject is unresolvable (transient null)", async () => {
    // If the token provider transiently resolves no subject, ownership
    // cannot be verified: the item must be retained, not sent under an
    // anonymous/foreign token and not destroyed.
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    await enqueueTransaction(inputFixture({ idempotencyKey: "mine-unverifiable" }));
    setAccessTokenProvider(null);
    fetchMock.mockResolvedValue(okResponse());

    const result = await syncPendingTransactions();

    expect(result).toEqual({ synced: 0, dropped: 0, remaining: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listPendingTransactions()).toHaveLength(1);
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
