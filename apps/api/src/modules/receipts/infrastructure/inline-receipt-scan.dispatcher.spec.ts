import { describe, expect, it, vi } from "vitest";

import { InlineReceiptScanDispatcher } from "./inline-receipt-scan.dispatcher.js";

/**
 * T14 (S13): single-component deploys (Render free tier — no worker
 * service) run the SAME scan pipeline in-process, fire-and-forget. The
 * dispatcher never blocks the upload response and never lets a pipeline
 * failure reject the caller — the row stays `pending` and T12's POST
 * retry is the recovery path.
 */

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("InlineReceiptScanDispatcher (T14, S13)", () => {
  it("runs the handler asynchronously — enqueueScan returns before it fires", async () => {
    const order: string[] = [];
    const dispatcher = new InlineReceiptScanDispatcher(async () => {
      order.push("run");
    });

    await dispatcher.enqueueScan("r1", "ws-1");
    order.push("returned");

    await flush();
    expect(order).toEqual(["returned", "run"]);
  });

  it("passes receiptId and workspaceId through to the handler", async () => {
    const jobs: Array<{ receiptId: string; workspaceId: string }> = [];
    const dispatcher = new InlineReceiptScanDispatcher(async (job) => {
      jobs.push(job);
    });

    await dispatcher.enqueueScan("receipt-9", "ws-42");
    await flush();

    expect(jobs).toEqual([{ receiptId: "receipt-9", workspaceId: "ws-42" }]);
  });

  it("never rejects the caller when the handler rejects — the error is logged", async () => {
    const logger = { error: vi.fn() };
    const dispatcher = new InlineReceiptScanDispatcher(
      async () => {
        throw new Error("gemini boom");
      },
      { logger },
    );

    await expect(
      dispatcher.enqueueScan("r-fail", "ws-1"),
    ).resolves.toBeUndefined();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("r-fail"),
      expect.any(Error),
    );
  });

  it("survives a synchronously throwing runner the same way", async () => {
    const logger = { error: vi.fn() };
    const dispatcher = new InlineReceiptScanDispatcher(
      () => {
        throw new Error("sync explode");
      },
      { logger },
    );

    await expect(
      dispatcher.enqueueScan("r-sync", "ws-1"),
    ).resolves.toBeUndefined();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("r-sync"),
      expect.any(Error),
    );
  });

  it("close() drains in-flight scans before resolving", async () => {
    let release: (() => void) | null = null;
    const dispatcher = new InlineReceiptScanDispatcher(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    await dispatcher.enqueueScan("r-slow", "ws-1");
    await flush(); // let the deferred task start

    let closed = false;
    const closing = dispatcher.close().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(false);

    release!();
    await closing;
    expect(closed).toBe(true);
  });
});
