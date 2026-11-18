import { PgBoss } from "pg-boss";

import type { ReceiptScanDispatcher } from "../application/ports/receipt-scan-dispatcher.port.js";
import { RECEIPT_SCAN_QUEUE } from "../application/ports/receipt-scan-dispatcher.port.js";

/**
 * pg-boss producer for the `receipt-scan` queue (receipt-scan-drafts T3;
 * the T4 worker consumes it). Started lazily on first send so the API
 * does not hold a second pg-boss schema connection unless receipts are
 * actually uploaded; safe when no worker handler exists yet — jobs wait
 * in the queue.
 */
export class PgBossReceiptScanDispatcher implements ReceiptScanDispatcher {
  private readonly boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString });
    this.boss.on("error", (error) => {
      console.error("[receipts] pg-boss error:", error);
    });
  }

  async enqueueScan(receiptId: string): Promise<void> {
    await this.ensureStarted();
    await this.boss.send(RECEIPT_SCAN_QUEUE, { receiptId });
  }

  async close(): Promise<void> {
    if (this.started !== null) {
      await this.boss.stop();
    }
  }

  private ensureStarted(): Promise<void> {
    this.started ??= (async () => {
      await this.boss.start();
      // createQueue is ON CONFLICT-safe; the worker creates it too.
      await this.boss.createQueue(RECEIPT_SCAN_QUEUE);
    })();
    return this.started;
  }
}
