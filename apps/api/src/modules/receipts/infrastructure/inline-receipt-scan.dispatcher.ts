import type { ReceiptScanDispatcher } from "../application/ports/receipt-scan-dispatcher.port.js";

/**
 * Job payload forwarded to the scan pipeline — mirrors `ReceiptScanJob`
 * in `src/jobs/receipt-scan.ts`. The runner is injected by the
 * composition root so this adapter stays decoupled from the jobs layer
 * (which already depends on this module).
 */
export interface InlineScanJob {
  readonly receiptId: string;
  readonly workspaceId: string;
}

export type InlineScanRunner = (job: InlineScanJob) => Promise<void>;

export interface InlineReceiptScanDispatcherOptions {
  /** Deferral primitive — production uses setImmediate; specs inject sync. */
  readonly defer?: (task: () => void) => void;
  readonly logger?: Pick<Console, "error">;
  /**
   * Graceful-shutdown budget: close() waits for in-flight scans at most
   * this long, then resolves so the process can exit. A hung scanner
   * call must not block shutdown forever. Default 5s.
   */
  readonly drainMs?: number;
}

/**
 * In-process scan dispatcher (receipt-scan-drafts T14, S13): single-
 * component deploys (Render free tier — no worker service allowed) run
 * the SAME `handleReceiptScan` job fire-and-forget instead of
 * enqueueing on pg-boss. `enqueueScan` only schedules the run and
 * resolves immediately — the upload request keeps returning `pending`
 * and the existing poll contract is unchanged.
 *
 * Recovery: a process dying mid-scan leaves the row `pending`; T12's
 * `POST /api/v1/receipts/:id/retry` re-runs the pipeline over the same
 * storageKey — exactly the lost-job path pg-boss redelivery covered.
 */
export class InlineReceiptScanDispatcher implements ReceiptScanDispatcher {
  private readonly defer: (task: () => void) => void;
  private readonly logger: Pick<Console, "error">;
  private readonly drainMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private closing = false;

  constructor(
    private readonly run: InlineScanRunner,
    options: InlineReceiptScanDispatcherOptions = {},
  ) {
    this.defer = options.defer ?? ((task) => setImmediate(task));
    this.logger = options.logger ?? console;
    this.drainMs = options.drainMs ?? 5_000;
  }

  async enqueueScan(receiptId: string, workspaceId: string): Promise<void> {
    if (this.closing) {
      // Shutdown in progress: refuse instead of launching a scan the
      // process cannot finish. The row stays `pending` — POST retry
      // recovers it on the next boot.
      this.logger.error(
        `[receipts] inline scan ${receiptId} refused during shutdown`,
      );
      return;
    }
    const job: InlineScanJob = { receiptId, workspaceId };
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
        // NEVER reject the caller: the row stays pending and the T12
        // retry endpoint is the recovery path.
        this.logger.error(
          `[receipts] inline scan failed for ${job.receiptId}:`,
          error,
        );
      })
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }

  /**
   * Drains scans already running before shutdown, bounded by
   * `drainMs` — a hung scanner request must not stall the exit. Scans
   * cut short die with the process; their rows stay `pending` and the
   * retry endpoint is the recovery path.
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
