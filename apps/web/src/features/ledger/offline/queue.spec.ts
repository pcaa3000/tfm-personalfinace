import { beforeEach, describe, expect, it } from "vitest";

import { setAccessTokenProvider } from "../api";
import { inputFixture, jwtFixture } from "./fixtures";
import {
  clearPendingTransactions,
  enqueueTransaction,
  ledgerDb,
  listPendingTransactions,
  markSyncAttempt,
  removePendingTransaction,
} from "./queue";

beforeEach(async () => {
  setAccessTokenProvider(null);
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

  // GAP-SEC-08 (S6): every queued item is bound to the identity that
  // created it, so sync can refuse to drain it under another session.
  it("stamps the current caller subject on the queued item", async () => {
    setAccessTokenProvider(async () => jwtFixture("user-a"));
    await enqueueTransaction(inputFixture());

    const [item] = await listPendingTransactions();
    expect(item?.ownerSubject).toBe("user-a");
  });

  it("leaves ownerSubject null with no identity provider (dev bypass)", async () => {
    await enqueueTransaction(inputFixture());

    const [item] = await listPendingTransactions();
    expect(item?.ownerSubject).toBeNull();
  });

  it("clearPendingTransactions empties the outbox", async () => {
    await enqueueTransaction(inputFixture());
    await enqueueTransaction(inputFixture());

    await clearPendingTransactions();

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
