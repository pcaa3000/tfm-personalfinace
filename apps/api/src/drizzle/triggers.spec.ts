import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDrizzleDb } from "./db.js";
import { currencies } from "./schema.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

/**
 * S2 (hardening): the `set_updated_at` trigger defends `updatedAt` at the
 * database level, so a writer that forgets to set it still bumps the row —
 * the repository's explicit set stays as the primary mechanism.
 */
describe("database triggers (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const wsId = "trigger-spec-ws";
  const currencyId = randomUUID();

  afterAll(async () => {
    await db.delete(currencies).where(eq(currencies.workspaceId, wsId));
    await pool.end();
  });

  it("set_updated_at bumps updatedAt even when the UPDATE forgets it", async () => {
    await db
      .insert(currencies)
      .values({ id: currencyId, workspaceId: wsId, code: "XXX" });

    const [before] = await db
      .select({ updatedAt: currencies.updatedAt })
      .from(currencies)
      .where(eq(currencies.id, currencyId));
    expect(before!.updatedAt).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 30));

    // Raw SQL update that does NOT touch updatedAt — the trigger owns it.
    await pool.query(
      'UPDATE "currencies_currencies" SET "code" = $1 WHERE "id" = $2',
      ["YYY", currencyId],
    );

    const [after] = await db
      .select({ updatedAt: currencies.updatedAt })
      .from(currencies)
      .where(eq(currencies.id, currencyId));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
  });
});
