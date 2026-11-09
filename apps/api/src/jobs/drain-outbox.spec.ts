import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createDrizzleDb, type DrizzleDb } from "../drizzle/db.js";
import { outboxEvents } from "../drizzle/schema.js";
import { insertOutboxEvent } from "../drizzle/outbox.js";
import {
  drainOutboxOnce,
  type OutboxDispatcher,
} from "./drain-outbox.js";
import { handleLedgerEvent } from "./ledger-notifications.js";
import { notifications } from "../drizzle/schema.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS = "jobs-spec-ws";

const { db, pool } = createDrizzleDb(DATABASE_URL);

async function cleanup(db: DrizzleDb): Promise<void> {
  await db.delete(outboxEvents).where(eq(outboxEvents.workspaceId, WS));
  await db.delete(notifications).where(eq(notifications.workspaceId, WS));
}

beforeAll(async () => {
  await cleanup(db);
});

afterAll(async () => {
  await cleanup(db);
  await pool.end();
});

describe("drainOutboxOnce (T3)", () => {
  it("dispatches pending events and marks them processed", async () => {
    await insertOutboxEvent(db, {
      workspaceId: WS,
      type: "transaction.confirmed",
      payload: { transactionId: "tx-drain-1", concept: "Sueldo" },
    });
    const rowsBefore = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.workspaceId, WS));
    const ours = rowsBefore.find(
      (r) => (r.payload as Record<string, unknown>).transactionId === "tx-drain-1",
    )!;
    const dispatcher: OutboxDispatcher = { send: vi.fn(async () => "job-1") };

    const drained = await drainOutboxOnce(db, dispatcher);

    // the drain also picks up any other pending rows in the shared dev DB;
    // assert OUR event was dispatched and marked, not the global count
    expect(drained).toBeGreaterThanOrEqual(1);
    expect(dispatcher.send).toHaveBeenCalledWith("ledger-events", {
      eventType: "transaction.confirmed",
      workspaceId: WS,
      outboxEventId: ours.id,
      payload: { transactionId: "tx-drain-1", concept: "Sueldo" },
    });
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.workspaceId, WS));
    expect(rows[0]?.processedAt).not.toBeNull();
  });

  it("does not redispatch already processed events (at-least-once dedup at drain)", async () => {
    const dispatcher: OutboxDispatcher = { send: vi.fn(async () => "job-2") };

    const drained = await drainOutboxOnce(db, dispatcher);

    expect(drained).toBe(0);
    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});

describe("handleLedgerEvent consumer (T3, S2)", () => {
  it("persists a notification row per consumed event", async () => {
    await handleLedgerEvent(db, {
      eventType: "transaction.confirmed",
      workspaceId: WS,
      outboxEventId: "notif-idempotency-1",
      payload: {
        transactionId: "tx-drain-1",
        concept: "Sueldo",
        amount: "4500.00",
        currency: "PEN",
      },
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.workspaceId, WS));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("transaction.confirmed");
    expect(rows[0]?.title).toBe("Movimiento registrado");
    expect(rows[0]?.body).toContain("Sueldo");
    expect(rows[0]?.body).toContain("4500.00");
  });

  it("is idempotent per outbox event: redelivery inserts no duplicate row (R3-001/R4-1)", async () => {
    const job = {
      eventType: "transaction.confirmed" as const,
      workspaceId: WS,
      outboxEventId: "notif-idempotency-2",
      payload: {
        transactionId: "tx-drain-2",
        concept: "Alquiler",
        amount: "900.00",
        currency: "PEN",
      },
    };

    await handleLedgerEvent(db, job);
    await handleLedgerEvent(db, job);
    await handleLedgerEvent(db, job);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, "notif-idempotency-2"));
    expect(rows).toHaveLength(1);
  });
});
