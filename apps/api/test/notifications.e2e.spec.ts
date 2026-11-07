import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  api,
  bootApp,
  cleanE2eData,
  closeTestDb,
  db,
  type AccountView,
  type ApiResponse,
  type E2eApp,
} from "./e2e-helpers.js";
import {
  LEDGER_EVENTS_QUEUE,
  drainOutboxOnce,
  type LedgerEventJob,
} from "../src/jobs/drain-outbox.js";
import { handleLedgerEvent } from "../src/jobs/ledger-notifications.js";

const MARKER = "|e2e-notif-";
const CAROL = { "x-dev-user": "e2e-notif-carol" };

interface NotificationView {
  id: string;
  workspaceId: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
}

let app: E2eApp;

beforeAll(async () => {
  app = await bootApp();
});

afterAll(async () => {
  await closeTestDb();
  await app.close();
});

beforeEach(async () => {
  await cleanE2eData(MARKER);
});

describe("outbox → queue → notifications pipeline (worker-pgboss S2)", () => {
  it("a confirmed transaction surfaces as a workspace notification", async () => {
    const account: ApiResponse<AccountView> = await api("/api/v1/accounts", {
      method: "POST",
      headers: CAROL,
      body: { name: `${MARKER}banco`, currency: "PEN" },
    });
    expect(account.status).toBe(201);

    const tx = await api("/api/v1/transactions", {
      method: "POST",
      headers: CAROL,
      body: {
        accountId: account.body.id,
        type: "income",
        amount: "4500.00",
        currency: "PEN",
        businessDate: "2026-10-01",
        timezone: "UTC",
        concept: `${MARKER}sueldo`,
        idempotencyKey: `e2e-notif-${randomUUID()}`,
      },
    });
    expect(tx.status).toBe(201);

    // worker-side: drain the outbox into the queue dispatcher, then run
    // the consumer over the dispatched job (same code src/worker.ts runs).
    const sent: LedgerEventJob[] = [];
    const drained = await drainOutboxOnce(db, {
      send: async (queue, job) => {
        expect(queue).toBe(LEDGER_EVENTS_QUEUE);
        sent.push(job);
        return "job-test";
      },
    });
    expect(drained).toBeGreaterThanOrEqual(1);

    const mine = sent.find(
      (j) => j.payload.transactionId === tx.body.id,
    );
    expect(mine).toBeTruthy();
    await handleLedgerEvent(db, mine!);

    const res = await api<NotificationView[]>("/api/v1/notifications", {
      headers: CAROL,
    });

    expect(res.status).toBe(200);
    const notification = res.body.find(
      (n) => n.kind === "transaction.confirmed" && n.body.includes("sueldo"),
    );
    expect(notification).toBeTruthy();
    expect(notification?.title).toBe("Movimiento registrado");
    expect(notification?.body).toContain("4500.00");
    expect(notification?.body).toContain("PEN");
  });
});
