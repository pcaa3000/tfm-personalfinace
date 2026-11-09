import { randomUUID } from "node:crypto";
import type { DrizzleDb } from "../drizzle/db.js";
import { notifications } from "../drizzle/schema.js";
import type { LedgerEventJob } from "./drain-outbox.js";

const TITLES: Record<string, string> = {
  "transaction.confirmed": "Movimiento registrado",
  "transaction.revised": "Movimiento editado",
  "transaction.voided": "Movimiento anulado",
};

/**
 * First consumer of the ledger-events queue (S2): every domain event
 * becomes a workspace notification row — the durable proof that the
 * outbox → queue → handler pipeline works end to end.
 */
export async function handleLedgerEvent(
  db: DrizzleDb,
  job: LedgerEventJob,
): Promise<void> {
  const payload = job.payload;
  const concept = String(payload.concept ?? "");
  const amount = payload.amount !== undefined ? String(payload.amount) : "";
  const currency = payload.currency !== undefined ? String(payload.currency) : "";
  const detail = [concept, [amount, currency].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
  // Idempotent per outbox event (R3-001/R4-1): drain is at-least-once, so a
  // redelivered job re-inserts the same row id and is a no-op, not a duplicate.
  // Legacy in-flight jobs (enqueued by the pre-fix drain) lack outboxEventId:
  // a generated uuid keeps the insert valid through the one-time deploy window.
  await db.insert(notifications).values({
    id: job.outboxEventId ?? randomUUID(),
    workspaceId: job.workspaceId,
    kind: job.eventType,
    title: TITLES[job.eventType] ?? job.eventType,
    body: detail || job.eventType,
  }).onConflictDoNothing();
}
