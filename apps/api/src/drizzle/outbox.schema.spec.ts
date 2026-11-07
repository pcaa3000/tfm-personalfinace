import { afterAll, describe, expect, it } from "vitest";

import { createDrizzleDb } from "./db.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

/**
 * T1 (worker-pgboss-outbox): the durable outbox + notifications tables
 * exist in the physical schema with the columns the pipeline needs.
 */
describe("outbox schema (integration, real Postgres)", () => {
  const { pool } = createDrizzleDb(DATABASE_URL);

  afterAll(async () => {
    await pool.end();
  });

  async function columnsOf(table: string): Promise<Map<string, ColumnRow>> {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = $1`,
      [table],
    );
    return new Map(result.rows.map((row) => [row.column_name, row]));
  }

  it("jobs_outbox_events persists events durably with a pending marker", async () => {
    const cols = await columnsOf("jobs_outbox_events");

    for (const name of [
      "id",
      "workspaceId",
      "type",
      "payload",
      "occurredAt",
      "processedAt",
    ]) {
      expect(cols.has(name), `missing column ${name}`).toBe(true);
    }
    expect(cols.get("payload")?.data_type).toBe("jsonb");
    // null until the drainer dispatches it to pg-boss
    expect(cols.get("processedAt")?.is_nullable).toBe("YES");
  });

  it("notifications_notifications stores the consumer output per workspace", async () => {
    const cols = await columnsOf("notifications_notifications");

    for (const name of [
      "id",
      "workspaceId",
      "kind",
      "title",
      "body",
      "createdAt",
    ]) {
      expect(cols.has(name), `missing column ${name}`).toBe(true);
    }
  });
});
