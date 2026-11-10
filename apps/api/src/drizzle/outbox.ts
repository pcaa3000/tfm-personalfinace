import { randomUUID } from "node:crypto";

import type { DrizzleDb } from "./db.js";
import { outboxEvents } from "./schema.js";

export interface OutboxEventInput {
  readonly workspaceId: string;
  /** Dotted event type, e.g. "transaction.confirmed". */
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt?: Date;
}

/**
 * Transactional outbox (worker-pgboss-outbox S1): writes the domain event
 * INSIDE the caller's business transaction. If the commit fails nothing
 * was published; once committed the row is durable until the worker
 * drains it (`processedAt IS NULL`).
 */
export async function insertOutboxEvent(
  tx: DrizzleDb,
  event: OutboxEventInput,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: randomUUID(),
    workspaceId: event.workspaceId,
    type: event.type,
    payload: event.payload,
    ...(event.occurredAt !== undefined
      ? { occurredAt: event.occurredAt }
      : {}),
  });
}
