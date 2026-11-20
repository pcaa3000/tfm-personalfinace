import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { createDrizzleDb } from "../drizzle/db.js";
import { voiceNotes } from "../drizzle/schema.js";
import { LocalReceiptStorage } from "../modules/receipts/infrastructure/local-receipt-storage.js";
import type { VoiceStoragePort } from "../modules/voices/index.js";
import {
  purgeExpiredVoiceMedia,
  VOICE_PURGE_BATCH_SIZE,
} from "./purge-voice-media.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS = "voice-purge-spec-ws";
const { db, pool } = createDrizzleDb(DATABASE_URL);

const NOW = new Date("2026-12-01T03:00:00.000Z");
const CLOCK = { now: () => NOW };

let storageDir: string;
// Voice notes share the receipts storage driver instance (voice-drafts
// T1, S5): the spec exercises the real local driver through the
// voices-owned port contract.
let storage: LocalReceiptStorage;

/**
 * Inserts a note row directly — the spec controls `expiresAt` exactly
 * (the domain fixes it at creation, so rows are written as the
 * migration would have left them). `transcript` mimics a processed
 * note: it must survive the media purge like every other column.
 */
async function seedNote(overrides: {
  id: string;
  expiresAt: Date;
  mediaDeletedAt?: Date | null;
  storageKey?: string;
  withObject?: boolean;
}): Promise<void> {
  const key =
    overrides.storageKey ?? `quarantine/${WS}/${overrides.id}.webm`;
  if (overrides.withObject !== false) {
    await storage.save(key, Uint8Array.from([0x1a, 0x45]), "audio/webm");
  }
  await db.insert(voiceNotes).values({
    id: overrides.id,
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: key,
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 2,
    status: "confirmed",
    transcript: "compré un sol de pan",
    expiresAt: overrides.expiresAt,
    mediaDeletedAt: overrides.mediaDeletedAt ?? null,
  });
}

async function noteRow(id: string) {
  const [row] = await db
    .select()
    .from(voiceNotes)
    .where(eq(voiceNotes.id, id))
    .limit(1);
  return row;
}

async function cleanup(): Promise<void> {
  await db.delete(voiceNotes).where(eq(voiceNotes.workspaceId, WS));
}

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "tfm-voice-purge-spec-"));
  storage = new LocalReceiptStorage(storageDir);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

describe("purgeExpiredVoiceMedia (voice-drafts T6, S7)", () => {
  it("deletes the object and stamps mediaDeletedAt on every expired note; the row and transcript survive", async () => {
    await seedNote({ id: "vpurge-expired-1", expiresAt: new Date("2026-12-01T00:00:00.000Z") });
    await seedNote({ id: "vpurge-expired-2", expiresAt: new Date("2026-11-01T00:00:00.000Z") });
    await seedNote({ id: "vpurge-fresh", expiresAt: new Date("2026-12-10T00:00:00.000Z") });

    const purged = await purgeExpiredVoiceMedia(
      { db, storage, clock: CLOCK },
      VOICE_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(2);
    for (const id of ["vpurge-expired-1", "vpurge-expired-2"]) {
      const row = await noteRow(id);
      expect(row?.mediaDeletedAt).toEqual(NOW);
      expect(await storage.open(row!.storageKey)).toBeNull();
      // Same retention semantics as receipts (CA-012): the note row,
      // its status and its transcript survive the purge.
      expect(row?.status).toBe("confirmed");
      expect(row?.transcript).toBe("compré un sol de pan");
    }
    const fresh = await noteRow("vpurge-fresh");
    expect(fresh?.mediaDeletedAt).toBeNull();
    expect(await storage.open(fresh!.storageKey)).not.toBeNull();
  });

  it("is idempotent: a second run finds nothing to purge (media_deleted_at set)", async () => {
    const purged = await purgeExpiredVoiceMedia(
      { db, storage, clock: CLOCK },
      VOICE_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(0);
  });

  it("tolerates an already-missing storage object — the row is still marked", async () => {
    await seedNote({
      id: "vpurge-no-object",
      expiresAt: new Date("2026-11-20T00:00:00.000Z"),
      withObject: false,
    });

    const purged = await purgeExpiredVoiceMedia(
      { db, storage, clock: CLOCK },
      VOICE_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(1);
    const row = await noteRow("vpurge-no-object");
    expect(row?.mediaDeletedAt).toEqual(NOW);
  });

  it("skips rows already marked media_deleted_at", async () => {
    await seedNote({
      id: "vpurge-early",
      expiresAt: new Date("2026-11-20T00:00:00.000Z"),
      mediaDeletedAt: new Date("2026-11-25T00:00:00.000Z"),
      withObject: false,
    });
    const spy = vi.fn(async () => undefined);
    const wrapped: VoiceStoragePort = {
      save: storage.save.bind(storage),
      open: storage.open.bind(storage),
      delete: spy,
    };

    const purged = await purgeExpiredVoiceMedia(
      { db, storage: wrapped, clock: CLOCK },
      VOICE_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a per-item storage failure is logged, leaves the row unmarked and does not abort the batch", async () => {
    await seedNote({ id: "vpurge-fail", expiresAt: new Date("2026-11-10T00:00:00.000Z") });
    await seedNote({ id: "vpurge-ok", expiresAt: new Date("2026-11-10T00:00:00.000Z") });
    const failKey = `quarantine/${WS}/vpurge-fail.webm`;
    const wrapped: VoiceStoragePort = {
      save: storage.save.bind(storage),
      open: storage.open.bind(storage),
      delete: vi.fn(async (key: string) => {
        if (key === failKey) throw new Error("storage unreachable");
        return storage.delete(key);
      }),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const purged = await purgeExpiredVoiceMedia(
      { db, storage: wrapped, clock: CLOCK },
      VOICE_PURGE_BATCH_SIZE,
    );

    expect(purged).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    const failed = await noteRow("vpurge-fail");
    expect(failed?.mediaDeletedAt).toBeNull();
    const okRow = await noteRow("vpurge-ok");
    expect(okRow?.mediaDeletedAt).toEqual(NOW);
    errorSpy.mockRestore();
  });

  it("honours the batch limit — the rest stays for the next run", async () => {
    await seedNote({ id: "vpurge-batch-1", expiresAt: new Date("2026-11-05T00:00:00.000Z") });
    await seedNote({ id: "vpurge-batch-2", expiresAt: new Date("2026-11-05T00:00:00.000Z") });

    const purged = await purgeExpiredVoiceMedia(
      { db, storage, clock: CLOCK },
      1,
    );

    expect(purged).toBe(1);
    const rows = await Promise.all(
      ["vpurge-batch-1", "vpurge-batch-2"].map(noteRow),
    );
    expect(
      rows.filter((r) => r?.mediaDeletedAt !== null),
    ).toHaveLength(1);
    const marked = await db
      .select({ id: voiceNotes.id })
      .from(voiceNotes)
      .where(inArray(voiceNotes.id, ["vpurge-batch-1", "vpurge-batch-2"]));
    expect(marked).toHaveLength(2);
  });
});
