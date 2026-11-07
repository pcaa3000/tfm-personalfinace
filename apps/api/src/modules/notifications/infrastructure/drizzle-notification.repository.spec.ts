import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { notifications } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { DrizzleNotificationRepository } from "./drizzle-notification.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-notif-spec-a";
const WS_B = "drizzle-notif-spec-b";

const { db, pool } = createDrizzleDb(DATABASE_URL);
const repository = new DrizzleNotificationRepository(db);

function workspaceId(value: string): WorkspaceId {
  const result = WorkspaceId.create(value);
  if (!result.ok) throw result.error;
  return result.value;
}

beforeAll(async () => {
  await db
    .delete(notifications)
    .where(inArray(notifications.workspaceId, [WS_A, WS_B]));
  await db.insert(notifications).values([
    {
      id: "notif-old",
      workspaceId: WS_A,
      kind: "transaction.confirmed",
      title: "Movimiento registrado",
      body: "Vieja · 10.00 PEN",
      createdAt: new Date("2026-11-01T09:00:00Z"),
    },
    {
      id: "notif-new",
      workspaceId: WS_A,
      kind: "transaction.voided",
      title: "Movimiento anulado",
      body: "Nueva · 20.00 PEN",
      createdAt: new Date("2026-11-02T09:00:00Z"),
    },
    {
      id: "notif-other",
      workspaceId: WS_B,
      kind: "transaction.confirmed",
      title: "Otro workspace",
      body: "Ajena",
      createdAt: new Date("2026-11-03T09:00:00Z"),
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(notifications)
    .where(inArray(notifications.workspaceId, [WS_A, WS_B]));
  await pool.end();
});

describe("DrizzleNotificationRepository", () => {
  it("lists workspace notifications newest first", async () => {
    const rows = await repository.list(workspaceId(WS_A));

    expect(rows.map((r) => r.id)).toEqual(["notif-new", "notif-old"]);
  });
});
