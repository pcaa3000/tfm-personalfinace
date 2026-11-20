import { describe, expect, it, vi } from "vitest";

import { InlineVoiceDraftDispatcher } from "./inline-voice-draft.dispatcher.js";

/**
 * voice-drafts T1 (S5): single-component deploys (Render free tier —
 * no worker service) run the draft pipeline in-process,
 * fire-and-forget. The dispatcher never blocks the upload response and
 * never lets a pipeline failure reject the caller — the row stays
 * `pending` and the retry endpoint (T3) is the recovery path.
 */

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("InlineVoiceDraftDispatcher (voice-drafts T1, S5)", () => {
  it("runs the handler asynchronously — enqueueDraft returns before it fires", async () => {
    const order: string[] = [];
    const dispatcher = new InlineVoiceDraftDispatcher(async () => {
      order.push("run");
    });

    await dispatcher.enqueueDraft("n1", "ws-1");
    order.push("returned");

    await flush();
    expect(order).toEqual(["returned", "run"]);
  });

  it("passes voiceNoteId and workspaceId through to the handler", async () => {
    const jobs: Array<{ voiceNoteId: string; workspaceId: string }> = [];
    const dispatcher = new InlineVoiceDraftDispatcher(async (job) => {
      jobs.push(job);
    });

    await dispatcher.enqueueDraft("note-9", "ws-42");
    await flush();

    expect(jobs).toEqual([{ voiceNoteId: "note-9", workspaceId: "ws-42" }]);
  });

  it("never rejects the caller when the handler rejects — the error is logged", async () => {
    const logger = { error: vi.fn() };
    const dispatcher = new InlineVoiceDraftDispatcher(
      async () => {
        throw new Error("gemini boom");
      },
      { logger },
    );

    await expect(
      dispatcher.enqueueDraft("n-fail", "ws-1"),
    ).resolves.toBeUndefined();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("n-fail"),
      expect.any(Error),
    );
  });

  it("survives a synchronously throwing runner the same way", async () => {
    const logger = { error: vi.fn() };
    const dispatcher = new InlineVoiceDraftDispatcher(
      () => {
        throw new Error("sync explode");
      },
      { logger },
    );

    await expect(
      dispatcher.enqueueDraft("n-sync", "ws-1"),
    ).resolves.toBeUndefined();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("n-sync"),
      expect.any(Error),
    );
  });

  it("close() drains in-flight jobs before resolving", async () => {
    let release: (() => void) | null = null;
    const dispatcher = new InlineVoiceDraftDispatcher(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    await dispatcher.enqueueDraft("n-slow", "ws-1");
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

  it("refuses new jobs once close() started — the pending row is recoverable via retry", async () => {
    const runner = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const dispatcher = new InlineVoiceDraftDispatcher(runner, { logger });

    const closing = dispatcher.close();
    await dispatcher.enqueueDraft("n-late", "ws-1");
    await flush();
    await closing;

    expect(runner).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("n-late"),
    );
  });

  it("close() resolves after the drain deadline even if a job hangs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const dispatcher = new InlineVoiceDraftDispatcher(
        () => new Promise<void>(() => {}), // never resolves
        { drainMs: 50 },
      );

      await dispatcher.enqueueDraft("n-hung", "ws-1");
      await flush(); // deferred task started

      let closed = false;
      const closing = dispatcher.close().then(() => {
        closed = true;
      });
      await flush();
      expect(closed).toBe(false);

      vi.advanceTimersByTime(51);
      await closing;
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
