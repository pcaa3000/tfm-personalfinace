import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTransactionOrQueue } from "./create-or-queue";
import { inputFixture, viewFixture } from "./fixtures";
import { ledgerDb, listPendingTransactions } from "./queue";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

beforeEach(async () => {
  await ledgerDb.pendingTransactions.clear();
  fetchMock.mockReset();
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
