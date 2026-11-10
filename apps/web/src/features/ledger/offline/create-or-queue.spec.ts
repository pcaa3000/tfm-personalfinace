import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessTokenProvider } from "../api";
import { createTransactionOrQueue } from "./create-or-queue";
import { inputFixture, jwtFixture, viewFixture } from "./fixtures";
import { ledgerDb, listPendingTransactions } from "./queue";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  setAccessTokenProvider(null);
  await ledgerDb.pendingTransactions.clear();
  fetchMock.mockReset();
});

afterEach(() => {
  setAccessTokenProvider(null);
});

describe("createTransactionOrQueue", () => {
  it("returns the server view when online", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(viewFixture()), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await createTransactionOrQueue(inputFixture());

    expect(result.pendingSync).toBeUndefined();
    expect(await listPendingTransactions()).toHaveLength(0);
  });

  it("enqueues a pending row when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const input = inputFixture({ idempotencyKey: "offline-key" });

    const result = await createTransactionOrQueue(input);

    expect(result.pendingSync).toBe(true);
    expect(result.id).toBe("pending:offline-key");
    const pending = await listPendingTransactions();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.input).toEqual(input);
  });

  // GAP-SEC-08 (S6): the queued record carries the subject that created
  // it, so a different session can never drain it (see sync.spec.ts).
  it("stamps the caller subject on the queued row", async () => {
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await createTransactionOrQueue(inputFixture());

    const [item] = await listPendingTransactions();
    expect(item?.ownerSubject).toBe("user-a");
  });

  it("does not queue server rejections", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_BODY" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      createTransactionOrQueue(inputFixture()),
    ).rejects.toThrow();
    expect(await listPendingTransactions()).toHaveLength(0);
  });
});
