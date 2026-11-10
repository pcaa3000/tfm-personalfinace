import { eq, sql } from "drizzle-orm";

import type { DrizzleDb } from "../drizzle/db.js";
import { outboxEvents } from "../drizzle/schema.js";

export const LEDGER_EVENTS_QUEUE = "ledger-events";

/** Job envelope dispatched to the `ledger-events` queue. */
export interface LedgerEventJob {
  readonly eventType: string;
  readonly workspaceId: string;
  /**
   * Stable outbox row id — consumers deduplicate on this (at-least-once).
   * Optional: jobs enqueued by the pre-fix drain lack it (deploy window).
   */
  readonly outboxEventId?: string;
  readonly payload: Record<string, unknown>;
}

/** Anything that can enqueue — PgBoss in prod, a spy in specs. */
export interface OutboxDispatcher {
  send(queue: string, job: LedgerEventJob): Promise<unknown>;
}

interface PendingRow {
  id: string;
  type: string;
  workspaceId: string;
  payload: Record<string, unknown>;
}

/**
 * Drains pending `jobs_outbox_events` rows into the job queue
 * (worker-pgboss-outbox T3). Rows are locked `FOR UPDATE SKIP LOCKED`
 * inside the same transaction that marks `processedAt`, so concurrent
 * workers never double-dispatch a row; a crash before commit rolls the
 * marks back and the rows get redispatched (at-least-once — consumers
 * stay idempotent).
 *
 * A row whose send throws is skipped — left unprocessed so a later drain
 * retries it — without aborting the rest of the batch, so one bad event
 * cannot stall the whole pipeline (R3-drain-send-inside-tx).
 */
export async function drainOutboxOnce(
  db: DrizzleDb,
  dispatcher: OutboxDispatcher,
  limit = 50,
): Promise<number> {
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id, type, "workspaceId", payload
      FROM jobs_outbox_events
      WHERE "processedAt" IS NULL
      ORDER BY "occurredAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    const pending = result.rows as unknown as PendingRow[];
    let sent = 0;
    for (const row of pending) {
      try {
        await dispatcher.send(LEDGER_EVENTS_QUEUE, {
          eventType: row.type,
          workspaceId: row.workspaceId,
          outboxEventId: row.id,
          payload: row.payload,
        });
      } catch {
        // Leave the row pending: a later drain retries it. Skipping keeps
        // the rest of the batch moving instead of stalling on the oldest
        // permanently-failing event.
        continue;
      }
      await tx
        .update(outboxEvents)
        .set({ processedAt: new Date() })
        .where(eq(outboxEvents.id, row.id));
      sent += 1;
    }
    return sent;
  });
}
