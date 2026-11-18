import { PgBoss } from "pg-boss";

import { requiredEnv } from "./env.js";
import { createDrizzleDb } from "./drizzle/db.js";
import {
  createReceiptStorage,
  receiptStorageFromProcess,
} from "./hono/composition.js";
import {
  LEDGER_EVENTS_QUEUE,
  drainOutboxOnce,
  type LedgerEventJob,
} from "./jobs/drain-outbox.js";
import { handleLedgerEvent } from "./jobs/ledger-notifications.js";
import {
  handleReceiptScan,
  type ReceiptScanJob,
} from "./jobs/receipt-scan.js";
import { DrizzleCategoryValidationAdapter } from "./modules/categorization/index.js";
import { SystemClock } from "./modules/ledger/infrastructure/system-clock.adapter.js";
import {
  DrizzleReceiptScanRepository,
  GeminiReceiptScanAdapter,
  RECEIPT_SCAN_QUEUE,
} from "./modules/receipts/index.js";

export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

const DRAIN_INTERVAL_MS = Number(process.env.WORKER_DRAIN_MS ?? 2_000);

/**
 * Standalone worker process (S4): drains the transactional outbox into
 * pg-boss and runs the ledger-events consumer. pg-boss lives ONLY here
 * and in the jobs adapters — domain/application stay framework-free (S5).
 */
async function main(): Promise<void> {
  // NEW-SEC-13 (S8): no silent localhost fallback — fail fast at boot.
  const databaseUrl = requiredEnv("DATABASE_URL");
  const { db, pool } = createDrizzleDb(databaseUrl);
  const boss = new PgBoss({ connectionString: databaseUrl });

  boss.on("error", (error) => {
    console.error("[worker] pg-boss error:", error);
  });

  await boss.start();
  await boss.createQueue(LEDGER_EVENTS_QUEUE);
  await boss.createQueue(RECEIPT_SCAN_QUEUE);

  await boss.work(LEDGER_EVENTS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleLedgerEvent(db, job.data as LedgerEventJob);
    }
  });

  // receipt-scan-drafts T4+T5 (D1, S9): Gemini extraction+categorization.
  // GEMINI_API_KEY is mandatory — the worker refuses to boot without it
  // (fail-fast, same policy as DATABASE_URL); GEMINI_MODEL is optional.
  const receiptScanDeps = {
    scans: new DrizzleReceiptScanRepository(db),
    storage: createReceiptStorage(receiptStorageFromProcess()),
    categories: new DrizzleCategoryValidationAdapter(db),
    scanner: new GeminiReceiptScanAdapter({
      apiKey: requiredEnv("GEMINI_API_KEY"),
      model: process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
    }),
    clock: new SystemClock(),
  };
  await boss.work(RECEIPT_SCAN_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleReceiptScan(receiptScanDeps, job.data as ReceiptScanJob);
    }
  });

  const timer = setInterval(() => {
    void drainOutboxOnce(db, boss).catch((error) => {
      console.error("[worker] outbox drain failed:", error);
    });
  }, DRAIN_INTERVAL_MS);

  console.log(
    `[worker] up — draining outbox every ${DRAIN_INTERVAL_MS}ms, consuming ${LEDGER_EVENTS_QUEUE}`,
  );

  const shutdown = async () => {
    clearInterval(timer);
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
