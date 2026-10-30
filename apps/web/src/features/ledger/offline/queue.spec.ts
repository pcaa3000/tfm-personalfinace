import { beforeEach, describe, expect, it } from "vitest";

import { inputFixture } from "./fixtures";
import {
  enqueueTransaction,
  ledgerDb,
  listPendingTransactions,
  markSyncAttempt,
  removePendingTransaction,
} from "./queue";

beforeEach(async () => {
  await ledgerDb.pendingTransactions.clear();
});

describe("offline queue", () => {
  it("enqueues a transaction and lists it in order", async () => {
    const first = inputFixture({ concept: "first" });
    const second = inputFixture({ concept: "second" });
    await enqueueTransaction(first);
    await enqueueTransaction(second);

    const pending = await listPendingTransactions();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.input.concept).toBe("first");
    expect(pending[0]?.attempts).toBe(0);
  });

  it("never duplicates the same idempotencyKey", async () => {
    const input = inputFixture();
    await enqueueTransaction(input);
    await enqueueTransaction(input);

    expect(await listPendingTransactions()).toHaveLength(1);
  });

  it("removes a synced item", async () => {
    const input = inputFixture();
    await enqueueTransaction(input);
    await removePendingTransaction(input.idempotencyKey);

    expect(await listPendingTransactions()).toHaveLength(0);
  });

  it("records sync attempts with the last error", async () => {
    const input = inputFixture();
    await enqueueTransaction(input);
    await markSyncAttempt(input.idempotencyKey, new TypeError("fetch failed"));
    await markSyncAttempt(input.idempotencyKey, new Error("boom"));

    const [item] = await listPendingTransactions();
    expect(item?.attempts).toBe(2);
    expect(item?.lastError).toBe("boom");
  });
});
