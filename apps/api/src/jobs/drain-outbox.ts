import { eq, sql } from "drizzle-orm";

import type { DrizzleDb } from "../drizzle/db.js";
import { outboxEvents } from "../drizzle/schema.js";

export const LEDGER_EVENTS_QUEUE = "ledger-events";

/** Job envelope dispatched to the `ledger-events` queue. */
export interface LedgerEventJob {
  readonly eventType: string;
  readonly workspaceId: string;
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
    for (const row of pending) {
      await dispatcher.send(LEDGER_EVENTS_QUEUE, {
        eventType: row.type,
        workspaceId: row.workspaceId,
        payload: row.payload,
      });
      await tx
        .update(outboxEvents)
        .set({ processedAt: new Date() })
        .where(eq(outboxEvents.id, row.id));
    }
    return pending.length;
  });
}
