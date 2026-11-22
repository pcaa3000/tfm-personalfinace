import type { VoiceDraftDispatcher } from "../application/ports/voice-draft-dispatcher.port.js";

/**
 * Job payload forwarded to the draft pipeline — mirrors the receipts
 * scan job. The runner is injected by the composition root so this
 * adapter stays decoupled from the jobs layer (which already depends
 * on this module). T1 wires a placeholder runner; T2 swaps in
 * `handleVoiceDraft` without touching this adapter.
 */
export interface InlineVoiceDraftJob {
  readonly voiceNoteId: string;
  readonly workspaceId: string;
}

export type InlineVoiceDraftRunner = (job: InlineVoiceDraftJob) => Promise<void>;

export interface InlineVoiceDraftDispatcherOptions {
  /** Deferral primitive — production uses setImmediate; specs inject sync. */
  readonly defer?: (task: () => void) => void;
  readonly logger?: Pick<Console, "error">;
  /**
   * Graceful-shutdown budget: close() waits for in-flight jobs at most
   * this long, then resolves so the process can exit. A hung draft
   * call must not block shutdown forever. Default 5s.
   */
  readonly drainMs?: number;
}

/**
 * In-process draft dispatcher (voice-drafts T1, S5 — the `inline`
 * default): single-component deploys (Render free tier — no worker
 * service allowed) run the draft pipeline fire-and-forget instead of
 * enqueueing on pg-boss. `enqueueDraft` only schedules the run and
 * resolves immediately — the upload request keeps returning `pending`
 * and the poll contract is unchanged.
 *
 * Recovery: a process dying mid-draft leaves the row `pending`; the
 * retry endpoint (T3) re-runs the pipeline over the same storageKey —
 * exactly the lost-job path pg-boss redelivery covered.
 */
export class InlineVoiceDraftDispatcher implements VoiceDraftDispatcher {
  private readonly defer: (task: () => void) => void;
  private readonly logger: Pick<Console, "error">;
  private readonly drainMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private closing = false;

  constructor(
    private readonly run: InlineVoiceDraftRunner,
    options: InlineVoiceDraftDispatcherOptions = {},
  ) {
    this.defer = options.defer ?? ((task) => setImmediate(task));
    this.logger = options.logger ?? console;
    this.drainMs = options.drainMs ?? 5_000;
  }

  async enqueueDraft(voiceNoteId: string, workspaceId: string): Promise<void> {
    if (this.closing) {
      // Shutdown in progress: refuse instead of launching a job the
      // process cannot finish. The row stays `pending` — retry
      // recovers it on the next boot.
      this.logger.error(
        `[voices] inline voice-draft ${voiceNoteId} refused during shutdown`,
      );
      return;
    }
    const job: InlineVoiceDraftJob = { voiceNoteId, workspaceId };
    const tracked = new Promise<void>((resolve) => {
      this.defer(() => {
        resolve(
          Promise.resolve()
            .then(() => this.run(job))
            .then(() => undefined),
        );
      });
    })
      .catch((error: unknown) => {
        // NEVER reject the caller: the row stays pending and the
        // retry endpoint is the recovery path.
        this.logger.error(
          `[voices] inline voice-draft failed for ${job.voiceNoteId}:`,
          error,
        );
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }

  /**
   * Drains jobs already running before shutdown, bounded by
   * `drainMs` — a hung draft request must not stall the exit. Jobs
   * cut short die with the process; their rows stay `pending` and
   * the retry endpoint is the recovery path.
   */
  async close(): Promise<void> {
    this.closing = true;
    let deadline: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, this.drainMs);
        deadline.unref?.();
      }),
    ]);
    if (deadline) clearTimeout(deadline);
  }
}
