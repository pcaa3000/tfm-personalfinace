import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { ledgerTransactions, voiceNotes } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { VoiceNote } from "../domain/voice-note.js";
import { DrizzleVoiceNoteRepository } from "./drizzle-voice-note.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "voice-repo-spec-a";
const WS_B = "voice-repo-spec-b";
// Dedicated workspaces so keyset pages and media-deleted exclusion see
// ONLY this spec's rows.
const WS_PAGES = "voice-repo-spec-pages";
const WS_GONE = "voice-repo-spec-gone";
const WORKSPACES = [WS_A, WS_B, WS_PAGES, WS_GONE];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) throw id.error;
  return id.value;
}

function makeNote(overrides: Partial<{
  id: string;
  workspaceId: WorkspaceId;
  storageKey: string;
  fileHash: string;
  now: Date;
}> = {}): VoiceNote {
  const note = VoiceNote.quarantine({
    id: overrides.id ?? "note-spec-1",
    workspaceId: overrides.workspaceId ?? workspaceId(WS_A),
    uploaderSubject: "user-1",
    storageKey: overrides.storageKey ?? `quarantine/${WS_A}/note-spec-1.webm`,
    originalFilename: "nota.webm",
    mimeType: "audio/webm",
    sizeBytes: 1234,
    // Unique hash per note id by default — the UNIQUE(workspaceId,
    // fileHash) index would collide otherwise within a test.
    fileHash:
      overrides.fileHash ??
      (overrides.id ?? "note-spec-1").padEnd(64, "0").slice(0, 64),
    now: overrides.now ?? new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!note.ok) throw note.error;
  return note.value;
}

async function cleanupAll(db: ReturnType<typeof createDrizzleDb>["db"]) {
  await db
    .delete(voiceNotes)
    .where(inArray(voiceNotes.workspaceId, WORKSPACES));
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
}

/**
 * voice_notes.transactionId has an FK to ledger_transactions — a
 * confirmed note in a spec needs a real transaction row behind it.
 */
async function seedTransaction(
  db: ReturnType<typeof createDrizzleDb>["db"],
  id: string,
  workspace: string,
): Promise<void> {
  await db.insert(ledgerTransactions).values({
    id,
    workspaceId: workspace,
    idempotencyKey: `note-list-${id}`,
    type: "expense",
    amountMinor: 1000n,
    currency: "PEN",
    businessDate: new Date("2026-11-10T00:00:00.000Z"),
    timezone: "UTC",
    concept: "voice list spec",
    status: "confirmed",
    origin: "voice",
    originRef: "note-list-newer",
    confirmedAt: new Date("2026-11-10T12:30:00.000Z"),
    confirmedBy: "voice-list-spec",
  });
}

describe("DrizzleVoiceNoteRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleVoiceNoteRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves a quarantined note and finds it by id within the workspace", async () => {
    const note = makeNote({ id: "note-spec-roundtrip" });
    await repository.save(note);

    const found = await repository.findById(
      workspaceId(WS_A),
      "note-spec-roundtrip",
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe("note-spec-roundtrip");
    expect(found!.workspaceId.value).toBe(WS_A);
    expect(found!.uploaderSubject).toBe("user-1");
    expect(found!.storageKey).toBe(`quarantine/${WS_A}/note-spec-1.webm`);
    expect(found!.originalFilename).toBe("nota.webm");
    expect(found!.mimeType).toBe("audio/webm");
    expect(found!.sizeBytes).toBe(1234);
    expect(found!.status).toBe("pending");
    expect(found!.transactionId).toBeNull();
    expect(found!.transcript).toBeNull();
    expect(found!.error).toBeNull();
    expect(found!.createdAt).toBeInstanceOf(Date);
    expect(found!.updatedAt).toBeInstanceOf(Date);
  });

  it("persists expiresAt (= createdAt + 30d), mediaDeletedAt and the transcript (S7)", async () => {
    const created = new Date("2026-11-10T12:00:00.000Z");
    const note = makeNote({ id: "note-spec-expiry", now: created });
    note.markDraftReady(
      { transcript: "compré pan" },
      { concept: "pan" },
      "compré pan",
      new Date("2026-11-10T12:00:20.000Z"),
    );
    await repository.save(note);

    const found = await repository.findById(
      workspaceId(WS_A),
      "note-spec-expiry",
    );
    expect(found?.expiresAt).toEqual(
      new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    expect(found?.mediaDeletedAt).toBeNull();
    // S7: transcript persisted — same sensitivity as the audio.
    expect(found?.transcript).toBe("compré pan");
    expect(found?.status).toBe("draft_ready");
    expect(found?.draftPayload).toEqual({ concept: "pan" });

    // markMediaDeleted survives a save/reload round-trip.
    const deletedAt = new Date("2026-11-20T12:00:00.000Z");
    found!.markMediaDeleted(deletedAt);
    await repository.save(found!);
    const reloaded = await repository.findById(
      workspaceId(WS_A),
      "note-spec-expiry",
    );
    expect(reloaded?.mediaDeletedAt).toEqual(deletedAt);
    expect(reloaded?.expiresAt).toEqual(found?.expiresAt);
    expect(reloaded?.status).toBe("draft_ready");
    expect(reloaded?.transcript).toBe("compré pan");
  });

  it("findById is workspace-scoped: other workspaces and unknown ids get null", async () => {
    await repository.save(makeNote({ id: "note-spec-scope" }));

    expect(
      await repository.findById(workspaceId(WS_B), "note-spec-scope"),
    ).toBeNull();
    expect(
      await repository.findById(workspaceId(WS_A), "note-spec-unknown"),
    ).toBeNull();
    expect(
      await repository.findById(workspaceId(WS_A), "note-spec-scope"),
    ).not.toBeNull();
  });

  it("findByFileHash returns the workspace-scoped note for a stored hash (dedup, S5)", async () => {
    const hashA = "b".repeat(64);
    const hashB = "c".repeat(64);
    await repository.save(makeNote({ id: "note-hash-a", fileHash: hashA }));
    // Same hash may legitimately exist in ANOTHER workspace.
    await repository.save(
      makeNote({
        id: "note-hash-b",
        workspaceId: workspaceId(WS_B),
        fileHash: hashA,
      }),
    );
    await repository.save(makeNote({ id: "note-hash-c", fileHash: hashB }));

    const found = await repository.findByFileHash(workspaceId(WS_A), hashA);
    expect(found?.id).toBe("note-hash-a");
    expect(found?.fileHash).toBe(hashA);
    expect(
      (await repository.findByFileHash(workspaceId(WS_B), hashA))?.id,
    ).toBe("note-hash-b");
    expect(
      await repository.findByFileHash(workspaceId(WS_A), "d".repeat(64)),
    ).toBeNull();
  });

  it("UNIQUE(workspaceId, fileHash) rejects a duplicate insert — the race the upload use case recovers from", async () => {
    const hash = "e".repeat(64);
    await repository.save(makeNote({ id: "note-dup-1", fileHash: hash }));

    await expect(
      repository.save(makeNote({ id: "note-dup-2", fileHash: hash })),
    ).rejects.toThrow();
  });

  it("listByWorkspace returns the workspace notes newest first with the linked transaction id", async () => {
    const older = makeNote({
      id: "note-list-older",
      now: new Date("2026-11-10T10:00:00.000Z"),
    });
    const newer = makeNote({
      id: "note-list-newer",
      now: new Date("2026-11-10T13:00:00.000Z"),
    });
    await seedTransaction(db, "trx-voice-1", WS_A);
    newer.markConfirmed("trx-voice-1", new Date("2026-11-10T13:01:00.000Z"));
    await repository.save(older);
    await repository.save(newer);
    await repository.save(
      makeNote({ id: "note-list-b", workspaceId: workspaceId(WS_B) }),
    );

    const listed = await repository.listByWorkspace(workspaceId(WS_A), {
      limit: 50,
    });

    expect(listed.hasMore).toBe(false);
    expect(listed.notes.every((n) => n.workspaceId.value === WS_A)).toBe(true);
    expect(listed.notes.some((n) => n.id === "note-list-b")).toBe(false);
    const interest = listed.notes
      .filter((n) => ["note-list-older", "note-list-newer"].includes(n.id))
      .map((n) => n.id);
    expect(interest).toEqual(["note-list-newer", "note-list-older"]);
    const newerListed = listed.notes.find((n) => n.id === "note-list-newer");
    expect(newerListed?.status).toBe("confirmed");
    expect(newerListed?.transactionId).toBe("trx-voice-1");
  });

  it("paginates with a (createdAt, id) keyset — no overlap, no gaps, ends hasMore=false", async () => {
    const ws = workspaceId(WS_PAGES);
    // Two rows SHARE a createdAt on purpose: only the id tiebreak makes
    // the keyset total.
    const seeds: Array<{ id: string; now: string }> = [
      { id: "page-e", now: "2026-11-10T15:00:00.000Z" },
      { id: "page-d", now: "2026-11-10T14:00:00.000Z" },
      { id: "page-c", now: "2026-11-10T13:00:00.000Z" },
      { id: "page-b", now: "2026-11-10T13:00:00.000Z" },
      { id: "page-a", now: "2026-11-10T12:00:00.000Z" },
    ];
    for (const seed of seeds) {
      await repository.save(
        makeNote({
          id: seed.id,
          workspaceId: ws,
          storageKey: `quarantine/${WS_PAGES}/${seed.id}.webm`,
          now: new Date(seed.now),
        }),
      );
    }

    const page1 = await repository.listByWorkspace(ws, { limit: 2 });
    expect(page1.notes.map((n) => n.id)).toEqual(["page-e", "page-d"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await repository.listByWorkspace(ws, {
      limit: 2,
      after: { createdAt: page1.notes.at(-1)!.createdAt, id: "page-d" },
    });
    // createdAt tiebreak: page-c and page-b share the instant; id DESC
    // orders them c then b, and neither is skipped nor repeated.
    expect(page2.notes.map((n) => n.id)).toEqual(["page-c", "page-b"]);
    expect(page2.hasMore).toBe(true);

    const page3 = await repository.listByWorkspace(ws, {
      limit: 2,
      after: { createdAt: page2.notes.at(-1)!.createdAt, id: "page-b" },
    });
    expect(page3.notes.map((n) => n.id)).toEqual(["page-a"]);
    expect(page3.hasMore).toBe(false);
  });

  it("media-deleted notes are excluded from listByWorkspace (retention, S7)", async () => {
    const ws = workspaceId(WS_GONE);
    const live = makeNote({
      id: "gone-live",
      workspaceId: ws,
      storageKey: `quarantine/${WS_GONE}/gone-live.webm`,
    });
    const deleted = makeNote({
      id: "gone-deleted",
      workspaceId: ws,
      storageKey: `quarantine/${WS_GONE}/gone-deleted.webm`,
    });
    deleted.markMediaDeleted(new Date("2026-11-20T12:00:00.000Z"));
    await repository.save(live);
    await repository.save(deleted);

    const listed = await repository.listByWorkspace(ws, { limit: 50 });

    const ids = listed.notes.map((n) => n.id);
    expect(ids).toContain("gone-live");
    expect(ids).not.toContain("gone-deleted");
  });
});
