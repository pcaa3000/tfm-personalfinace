import { describe, expect, it, vi } from "vitest";

import type { VoiceDraftConsentGuard } from "../application/voice-draft-consent-guard.js";
import type { VoiceDraftDispatcher } from "../application/ports/voice-draft-dispatcher.port.js";
import { ConsentGatedVoiceDraftDispatcher } from "./consent-gated-voice-draft.dispatcher.js";

/**
 * Dispatch-time consent gate (voice-drafts T5, S6 — docs/05
 * "Detiene nuevos envíos inmediatamente"): wraps ANY voice-draft
 * dispatcher (pgboss or inline) so an enqueue after revocation never
 * reaches the queue/runner — the guard fails the pending note so the
 * user sees the reason and a post-re-consent retry recovers it.
 */
describe("ConsentGatedVoiceDraftDispatcher (voice-drafts T5, S6)", () => {
  function fixture(dispatchable: boolean) {
    const inner: VoiceDraftDispatcher & { close(): Promise<void> } = {
      enqueueDraft: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const guard: Pick<VoiceDraftConsentGuard, "ensureDispatchable"> = {
      ensureDispatchable: vi.fn(async () => dispatchable),
    };
    const dispatcher = new ConsentGatedVoiceDraftDispatcher(inner, guard);
    return { inner, guard, dispatcher };
  }

  it("forwards the job to the inner dispatcher when the guard allows it", async () => {
    const { inner, guard, dispatcher } = fixture(true);

    await dispatcher.enqueueDraft("note-1", "ws-1");

    expect(guard.ensureDispatchable).toHaveBeenCalledWith("note-1", "ws-1");
    expect(inner.enqueueDraft).toHaveBeenCalledWith("note-1", "ws-1");
  });

  it("never enqueues after revocation — the guard already failed the note", async () => {
    const { inner, dispatcher } = fixture(false);

    await dispatcher.enqueueDraft("note-1", "ws-1");

    expect(inner.enqueueDraft).not.toHaveBeenCalled();
  });

  it("forwards close() to the inner dispatcher", async () => {
    const { inner, dispatcher } = fixture(true);

    await dispatcher.close();

    expect(inner.close).toHaveBeenCalled();
  });
});
