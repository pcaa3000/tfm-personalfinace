import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { periodCloses } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import { DrizzlePeriodCloseRepository } from "./drizzle-period-close.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "drizzle-close-spec-a";
const WS_B = "drizzle-close-spec-b";

const { db, pool } = createDrizzleDb(DATABASE_URL);
const repository = new DrizzlePeriodCloseRepository(db);

function workspaceId(value: string): WorkspaceId {
  const result = WorkspaceId.create(value);
  if (!result.ok) throw result.error;
  return result.value;
}

function close(
  overrides: Partial<Parameters<typeof PeriodClose.reconstitute>[0]> = {},
): PeriodClose {
  return PeriodClose.reconstitute({
    id: `close-${Math.random().toString(36).slice(2)}`,
    workspaceId: workspaceId(WS_A),
    currency: "EUR",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    timezone: "UTC",
    integrityDeclared: true,
    closedAt: new Date("2026-10-01T10:00:00Z"),
    invalidatedAt: null,
    supersededAt: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  });
}

beforeAll(async () => {
  await db
    .delete(periodCloses)
    .where(inArray(periodCloses.workspaceId, [WS_A, WS_B]));
});

afterAll(async () => {
  await db
    .delete(periodCloses)
    .where(inArray(periodCloses.workspaceId, [WS_A, WS_B]));
  await pool.end();
});

describe("DrizzlePeriodCloseRepository", () => {
  it("saves and finds the active close of a period", async () => {
    const entity = close({ id: "close-find" });
    await repository.save(entity);

    const found = await repository.findActiveByPeriod(
      workspaceId(WS_A),
      "EUR",
      "2026-09-01",
    );

    expect(found).not.toBeNull();
    expect(found?.id).toBe("close-find");
    expect(found?.currency).toBe("EUR");
    expect(found?.periodStart).toBe("2026-09-01");
    expect(found?.periodEnd).toBe("2026-09-30");
    expect(found?.integrityDeclared).toBe(true);
    expect(found?.invalidatedAt).toBeNull();
    expect(found?.supersededAt).toBeNull();
  });

  it("ignores superseded rows on find and lists only active closes", async () => {
    const stale = close({
      id: "close-sup",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    await repository.save(stale);
    stale.markSuperseded(new Date("2026-10-12T10:00:00Z"));
    await repository.save(stale);
    await repository.save(
      close({
        id: "close-new",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
      }),
    );

    const found = await repository.findActiveByPeriod(
      workspaceId(WS_A),
      "EUR",
      "2026-08-01",
    );
    expect(found?.id).toBe("close-new");

    const active = await repository.listActive(workspaceId(WS_A), "EUR");
    expect(active.map((c) => c.id)).not.toContain("close-sup");
    expect(active.map((c) => c.id)).toContain("close-new");
  });

  it("lists active closes newest period first, honoring the currency filter", async () => {
    await repository.save(
      close({
        id: "close-jul",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    );
    await repository.save(
      close({
        id: "close-usd",
        currency: "USD",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );
    await repository.save(
      close({
        id: "close-b",
        workspaceId: workspaceId(WS_B),
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
      }),
    );

    const eur = await repository.listActive(workspaceId(WS_A), "EUR");
    const starts = eur.map((c) => c.periodStart);
    expect([...starts].sort().reverse()).toEqual(starts);
    expect(eur.every((c) => c.currency === "EUR")).toBe(true);

    const usd = await repository.listActive(workspaceId(WS_A), "USD");
    expect(usd.map((c) => c.id)).toEqual(["close-usd"]);
  });

  it("invalidates only non-invalidated closes containing the business date", async () => {
    await repository.save(
      close({
        id: "close-hit",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
    );
    await repository.save(
      close({
        id: "close-miss-period",
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
      }),
    );
    await repository.save(
      close({
        id: "close-miss-currency",
        currency: "USD",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
    );
    await repository.save(
      close({
        id: "close-miss-ws",
        workspaceId: workspaceId(WS_B),
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
    );
    const alreadyStale = close({
      id: "close-miss-stale",
      // Wider window containing 2026-03-15: already-invalidated rows must
      // keep their original invalidatedAt.
      periodStart: "2026-02-15",
      periodEnd: "2026-03-31",
      invalidatedAt: new Date("2026-04-05T10:00:00Z"),
    });
    await repository.save(alreadyStale);

    const at = new Date("2026-10-20T08:00:00Z");
    await repository.invalidateCovering(
      workspaceId(WS_A),
      "EUR",
      "2026-03-15",
      at,
    );

    const eur = await repository.listActive(workspaceId(WS_A), "EUR");
    const byId = new Map(eur.map((c) => [c.id, c]));
    expect(byId.get("close-hit")?.invalidatedAt).toEqual(at);
    expect(byId.get("close-miss-stale")?.invalidatedAt).toEqual(
      new Date("2026-04-05T10:00:00Z"),
    );

    const april = await repository.listActive(workspaceId(WS_A), "EUR");
    expect(
      april.find((c) => c.id === "close-miss-period")?.invalidatedAt,
    ).toBeNull();
    const usd = await repository.listActive(workspaceId(WS_A), "USD");
    expect(
      usd.find((c) => c.id === "close-miss-currency")?.invalidatedAt,
    ).toBeNull();
    const other = await repository.listActive(workspaceId(WS_B), "EUR");
    expect(
      other.find((c) => c.id === "close-miss-ws")?.invalidatedAt,
    ).toBeNull();
  });

  it("enforces one active close per workspace+currency+period via the partial unique index", async () => {
    await repository.save(
      close({
        id: "close-uniq-1",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }),
    );

    await expect(
      repository.save(
        close({
          id: "close-uniq-2",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
        }),
      ),
    ).rejects.toThrow();

    // Once superseded, a new active close for the same period is allowed.
    const first = await repository.findActiveByPeriod(
      workspaceId(WS_A),
      "EUR",
      "2026-01-01",
    );
    expect(first).not.toBeNull();
    if (!first) return;
    first.markSuperseded(new Date("2026-10-20T09:00:00Z"));
    await repository.save(first);
    await repository.save(
      close({
        id: "close-uniq-3",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }),
    );
    const active = await repository.findActiveByPeriod(
      workspaceId(WS_A),
      "EUR",
      "2026-01-01",
    );
    expect(active?.id).toBe("close-uniq-3");
  });
});
