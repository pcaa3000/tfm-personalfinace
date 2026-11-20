import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb } from "../drizzle/db.js";
import { receiptScans } from "../drizzle/schema.js";
import { LocalReceiptStorage } from "../modules/receipts/infrastructure/local-receipt-storage.js";
import type { ReceiptStoragePort } from "../modules/receipts/index.js";
import {
  purgeExpiredReceiptMedia,
  RECEIPT_PURGE_BATCH_SIZE,
} from "./purge-receipt-media.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS = "purge-spec-ws";
const { db, pool } = createDrizzleDb(DATABASE_URL);

const NOW = new Date("2026-12-01T03:00:00.000Z");
const CLOCK = { now: () => NOW };

let storageDir: string;
let storage: LocalReceiptStorage;

/**
 * Inserts a scan row directly — the spec controls `expiresAt` exactly
 * (the domain fixes it at creation, so rows are written as the
 * migration would have left them).
 */
async function seedScan(overrides: {
  id: string;
  expiresAt: Date;
  mediaDeletedAt?: Date | null;
  storageKey?: string;
  withObject?: boolean;
}): Promise<void> {
  const key =
    overrides.storageKey ?? `quarantine/${WS}/${overrides.id}.jpg`;
  if (overrides.withObject !== false) {
    await storage.save(key, Uint8Array.from([0xff, 0xd8]), "image/jpeg");
  }
  await db.insert(receiptScans).values({
    id: overrides.id,
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: key,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2,
    status: "confirmed",
    expiresAt: overrides.expiresAt,
    mediaDeletedAt: overrides.mediaDeletedAt ?? null,
  });
}

async function scanRow(id: string) {
  const [row] = await db
    .select()
    .from(receiptScans)
    .where(eq(receiptScans.id, id))
    .limit(1);
  return row;
}

async function cleanup(): Promise<void> {
  await db.delete(receiptScans).where(eq(receiptScans.workspaceId, WS));
}

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "tfm-purge-spec-"));
  storage = new LocalReceiptStorage(storageDir);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

describe("purgeExpiredReceiptMedia (receipt-retention-30d T4, S4)", () => {
  it("deletes the object and stamps mediaDeletedAt on every expired scan", async () => {
    await seedScan({ id: "purge-expired-1", expiresAt: new Date("2026-12-01T00:00:00.000Z") });
    await seedScan({ id: "purge-expired-2", expiresAt: new Date("2026-11-01T00:00:00.000Z") });
    await seedScan({ id: "purge-fresh", expiresAt: new Date("2026-12-10T00:00:00.000Z") });

    const purged = await purgeExpiredReceiptMedia(
      { db, storage, clock: CLOCK },
      RECEIPT_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(2);
    for (const id of ["purge-expired-1", "purge-expired-2"]) {
      const row = await scanRow(id);
      expect(row?.mediaDeletedAt).toEqual(NOW);
      expect(await storage.open(row!.storageKey)).toBeNull();
      // CA-012: the scan row and its status survive the purge.
      expect(row?.status).toBe("confirmed");
    }
    const fresh = await scanRow("purge-fresh");
    expect(fresh?.mediaDeletedAt).toBeNull();
    expect(await storage.open(fresh!.storageKey)).not.toBeNull();
  });

  it("is idempotent: a second run finds nothing to purge (media_deleted_at set)", async () => {
    const purged = await purgeExpiredReceiptMedia(
      { db, storage, clock: CLOCK },
      RECEIPT_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(0);
  });

  it("tolerates an already-missing storage object — the row is still marked", async () => {
    await seedScan({
      id: "purge-no-object",
      expiresAt: new Date("2026-11-20T00:00:00.000Z"),
      withObject: false,
    });

    const purged = await purgeExpiredReceiptMedia(
      { db, storage, clock: CLOCK },
      RECEIPT_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(1);
    const row = await scanRow("purge-no-object");
    expect(row?.mediaDeletedAt).toEqual(NOW);
  });

  it("skips rows already marked media_deleted_at (e.g. early user deletion)", async () => {
    await seedScan({
      id: "purge-early",
      expiresAt: new Date("2026-11-20T00:00:00.000Z"),
      mediaDeletedAt: new Date("2026-11-25T00:00:00.000Z"),
      withObject: false,
    });
    const spy = vi.fn(async () => undefined);
    const wrapped: ReceiptStoragePort = {
      save: storage.save.bind(storage),
      open: storage.open.bind(storage),
      delete: spy,
    };

    const purged = await purgeExpiredReceiptMedia(
      { db, storage: wrapped, clock: CLOCK },
      RECEIPT_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a per-item storage failure is logged, leaves the row unmarked and does not abort the batch", async () => {
    await seedScan({ id: "purge-fail", expiresAt: new Date("2026-11-10T00:00:00.000Z") });
    await seedScan({ id: "purge-ok", expiresAt: new Date("2026-11-10T00:00:00.000Z") });
    const failKey = `quarantine/${WS}/purge-fail.jpg`;
    const wrapped: ReceiptStoragePort = {
      save: storage.save.bind(storage),
      open: storage.open.bind(storage),
      delete: vi.fn(async (key: string) => {
        if (key === failKey) throw new Error("storage unreachable");
        return storage.delete(key);
      }),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const purged = await purgeExpiredReceiptMedia(
      { db, storage: wrapped, clock: CLOCK },
      RECEIPT_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    const failed = await scanRow("purge-fail");
    expect(failed?.mediaDeletedAt).toBeNull();
    const okRow = await scanRow("purge-ok");
    expect(okRow?.mediaDeletedAt).toEqual(NOW);
    errorSpy.mockRestore();
  });

  it("honours the batch limit — the rest stays for the next run", async () => {
    await seedScan({ id: "purge-batch-1", expiresAt: new Date("2026-11-05T00:00:00.000Z") });
    await seedScan({ id: "purge-batch-2", expiresAt: new Date("2026-11-05T00:00:00.000Z") });

    const purged = await purgeExpiredReceiptMedia(
      { db, storage, clock: CLOCK },
      1,
    );

    expect(purged).toBe(1);
    const marked = (
      await db
        .select({ id: receiptScans.id })
        .from(receiptScans)
        .where(inArray(receiptScans.id, ["purge-batch-1", "purge-batch-2"]))
    ).filter((r) => r.id);
    const rows = await Promise.all(
      ["purge-batch-1", "purge-batch-2"].map(scanRow),
    );
    expect(
      rows.filter((r) => r?.mediaDeletedAt !== null),
    ).toHaveLength(1);
    expect(marked).toHaveLength(2);
  });
});
