import { PgBoss } from "pg-boss";

import { createDrizzleDb } from "./drizzle/db.js";
import {
  LEDGER_EVENTS_QUEUE,
  drainOutboxOnce,
  type LedgerEventJob,
} from "./jobs/drain-outbox.js";
import { handleLedgerEvent } from "./jobs/ledger-notifications.js";

const DRAIN_INTERVAL_MS = Number(process.env.WORKER_DRAIN_MS ?? 2_000);

/**
 * Standalone worker process (S4): drains the transactional outbox into
 * pg-boss and runs the ledger-events consumer. pg-boss lives ONLY here
 * and in the jobs adapters — domain/application stay framework-free (S5).
 */
async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";
  const { db, pool } = createDrizzleDb(databaseUrl);
  const boss = new PgBoss({ connectionString: databaseUrl });

  boss.on("error", (error) => {
    console.error("[worker] pg-boss error:", error);
  });

  await boss.start();
  await boss.createQueue(LEDGER_EVENTS_QUEUE);

  await boss.work(LEDGER_EVENTS_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleLedgerEvent(db, job.data as LedgerEventJob);
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
