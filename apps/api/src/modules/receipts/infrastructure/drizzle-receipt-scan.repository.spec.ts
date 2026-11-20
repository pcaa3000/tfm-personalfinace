import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { ledgerTransactions, receiptScans } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { ReceiptScan } from "../domain/receipt-scan.js";
import { DrizzleReceiptScanRepository } from "./drizzle-receipt-scan.repository.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const WS_A = "receipt-repo-spec-a";
const WS_B = "receipt-repo-spec-b";
// receipt-review-link T5 (S4): a dedicated workspace so keyset pages
// see ONLY this spec's rows — leftover WS_A scans would interleave.
const WS_PAGES = "receipt-repo-spec-pages";
// receipt-retention-30d T6 (S6): dedicated workspaces — the media-
// deleted exclusion and the purge-candidate selection must see ONLY
// this spec's rows.
const WS_GONE = "receipt-repo-spec-gone";
const WS_PURGE = "receipt-repo-spec-purge";
const WORKSPACES = [WS_A, WS_B, WS_PAGES, WS_GONE, WS_PURGE];

function workspaceId(value: string): WorkspaceId {
  const id = WorkspaceId.create(value);
  if (!id.ok) throw id.error;
  return id.value;
}

function makeScan(overrides: Partial<{
  id: string;
  workspaceId: WorkspaceId;
  storageKey: string;
  fileHash: string;
  now: Date;
}> = {}): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: overrides.id ?? "scan-spec-1",
    workspaceId: overrides.workspaceId ?? workspaceId(WS_A),
    uploaderSubject: "user-1",
    storageKey: overrides.storageKey ?? `quarantine/${WS_A}/scan-spec-1.jpg`,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    // Unique hash per scan id by default — the UNIQUE(workspaceId,
    // fileHash) index (T13) would collide otherwise within a test.
    fileHash:
      overrides.fileHash ??
      (overrides.id ?? "scan-spec-1").padEnd(64, "0").slice(0, 64),
    now: overrides.now ?? new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  return scan.value;
}

async function cleanupAll(db: ReturnType<typeof createDrizzleDb>["db"]) {
  await db
    .delete(receiptScans)
    .where(inArray(receiptScans.workspaceId, WORKSPACES));
  await db
    .delete(ledgerTransactions)
    .where(inArray(ledgerTransactions.workspaceId, WORKSPACES));
}

/**
 * receipt_scans.transactionId has an FK to ledger_transactions — a
 * confirmed scan in a spec needs a real transaction row behind it.
 */
async function seedTransaction(
  db: ReturnType<typeof createDrizzleDb>["db"],
  id: string,
  workspace: string,
): Promise<void> {
  await db.insert(ledgerTransactions).values({
    id,
    workspaceId: workspace,
    idempotencyKey: `scan-list-${id}`,
    type: "expense",
    amountMinor: 1000n,
    currency: "PEN",
    businessDate: new Date("2026-11-10T00:00:00.000Z"),
    timezone: "UTC",
    concept: "receipt list spec",
    status: "confirmed",
    origin: "ticket",
    originRef: "scan-list-newer",
    confirmedAt: new Date("2026-11-10T12:30:00.000Z"),
    confirmedBy: "scan-list-spec",
  });
}

describe("DrizzleReceiptScanRepository (integration, real Postgres)", () => {
  const { db, pool } = createDrizzleDb(DATABASE_URL);
  const repository = new DrizzleReceiptScanRepository(db);

  beforeAll(async () => {
    await cleanupAll(db);
  });

  afterAll(async () => {
    await cleanupAll(db);
    await pool.end();
  });

  it("saves a quarantined scan and finds it by id within the workspace", async () => {
    const scan = makeScan({ id: "scan-spec-roundtrip" });
    await repository.save(scan);

    const found = await repository.findById(
      workspaceId(WS_A),
      "scan-spec-roundtrip",
    );
    expect(found).not.toBeNull();
    expect(found!.id).toBe("scan-spec-roundtrip");
    expect(found!.workspaceId.value).toBe(WS_A);
    expect(found!.uploaderSubject).toBe("user-1");
    expect(found!.storageKey).toBe(`quarantine/${WS_A}/scan-spec-1.jpg`);
    expect(found!.originalFilename).toBe("ticket.jpg");
    expect(found!.mimeType).toBe("image/jpeg");
    expect(found!.sizeBytes).toBe(1234);
    expect(found!.status).toBe("pending");
    expect(found!.transactionId).toBeNull();
    expect(found!.error).toBeNull();
    expect(found!.createdAt).toBeInstanceOf(Date);
    expect(found!.updatedAt).toBeInstanceOf(Date);
  });

  it("persists expiresAt (= createdAt + 30d) and mediaDeletedAt (receipt-retention-30d T1, S1+S2)", async () => {
    const created = new Date("2026-11-10T12:00:00.000Z");
    const scan = makeScan({ id: "scan-spec-expiry", now: created });
    await repository.save(scan);

    const found = await repository.findById(
      workspaceId(WS_A),
      "scan-spec-expiry",
    );
    // Backfill semantics (S2): persisted expiresAt must equal
    // createdAt + 30 days — the same expression the migration uses.
    expect(found?.expiresAt).toEqual(
      new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    expect(found?.mediaDeletedAt).toBeNull();

    // markMediaDeleted survives a save/reload round-trip (S3).
    const deletedAt = new Date("2026-11-20T12:00:00.000Z");
    found!.markMediaDeleted(deletedAt);
    await repository.save(found!);
    const reloaded = await repository.findById(
      workspaceId(WS_A),
      "scan-spec-expiry",
    );
    expect(reloaded?.mediaDeletedAt).toEqual(deletedAt);
    expect(reloaded?.expiresAt).toEqual(found?.expiresAt);
    // CA-012: status/transaction untouched by media deletion.
    expect(reloaded?.status).toBe("pending");
  });

  it("findById is workspace-scoped: other workspaces and unknown ids get null", async () => {
    await repository.save(makeScan({ id: "scan-spec-scope" }));

    expect(
      await repository.findById(workspaceId(WS_B), "scan-spec-scope"),
    ).toBeNull();
    expect(
      await repository.findById(workspaceId(WS_A), "scan-spec-unknown"),
    ).toBeNull();
    expect(
      await repository.findById(workspaceId(WS_A), "scan-spec-scope"),
    ).not.toBeNull();
  });

  it("findByFileHash returns the workspace-scoped scan for a stored hash (T13, S12)", async () => {
    const hashA = "b".repeat(64);
    const hashB = "c".repeat(64);
    await repository.save(
      makeScan({ id: "scan-hash-a", fileHash: hashA }),
    );
    // Same hash may legitimately exist in ANOTHER workspace.
    await repository.save(
      makeScan({
        id: "scan-hash-b",
        workspaceId: workspaceId(WS_B),
        fileHash: hashA,
      }),
    );
    await repository.save(
      makeScan({ id: "scan-hash-c", fileHash: hashB }),
    );

    const found = await repository.findByFileHash(workspaceId(WS_A), hashA);
    expect(found?.id).toBe("scan-hash-a");
    expect(found?.fileHash).toBe(hashA);
    // Other workspace → its own row; unknown hash → null.
    expect(
      (await repository.findByFileHash(workspaceId(WS_B), hashA))?.id,
    ).toBe("scan-hash-b");
    expect(
      await repository.findByFileHash(
        workspaceId(WS_A),
        "d".repeat(64),
      ),
    ).toBeNull();
  });

  it("listByWorkspace returns the workspace scans newest first with the linked transaction id (receipt-review-link T1, S1)", async () => {
    const older = makeScan({
      id: "scan-list-older",
      now: new Date("2026-11-10T10:00:00.000Z"),
    });
    const newer = makeScan({
      id: "scan-list-newer",
      now: new Date("2026-11-10T13:00:00.000Z"),
    });
    await seedTransaction(db, "trx-list-1", WS_A);
    newer.markConfirmed("trx-list-1", new Date("2026-11-10T13:01:00.000Z"));
    await repository.save(older);
    await repository.save(newer);
    await repository.save(
      makeScan({ id: "scan-list-b", workspaceId: workspaceId(WS_B) }),
    );

    const listed = await repository.listByWorkspace(workspaceId(WS_A), {
      limit: 50,
    });

    // Only WS_A rows, newest first, no next page at this limit.
    expect(listed.hasMore).toBe(false);
    expect(listed.scans.every((s) => s.workspaceId.value === WS_A)).toBe(true);
    expect(listed.scans.some((s) => s.id === "scan-list-b")).toBe(false);
    const interest = listed.scans
      .filter((s) => ["scan-list-older", "scan-list-newer"].includes(s.id))
      .map((s) => s.id);
    expect(interest).toEqual(["scan-list-newer", "scan-list-older"]);
    // The persisted transaction link survives reconstitution.
    const newerListed = listed.scans.find((s) => s.id === "scan-list-newer");
    expect(newerListed?.status).toBe("confirmed");
    expect(newerListed?.transactionId).toBe("trx-list-1");
  });

  it("paginates with a (createdAt, id) keyset — no overlap, no gaps, ends hasMore=false (receipt-review-link T5, S4)", async () => {
    const ws = workspaceId(WS_PAGES);
    // Two rows SHARE a createdAt on purpose: only the id tiebreak makes
    // the keyset total — an offset or createdAt-only cursor would skip
    // or repeat one of them.
    const seeds: Array<{ id: string; now: string }> = [
      { id: "page-e", now: "2026-11-10T15:00:00.000Z" },
      { id: "page-d", now: "2026-11-10T14:00:00.000Z" },
      { id: "page-c", now: "2026-11-10T13:00:00.000Z" },
      { id: "page-b", now: "2026-11-10T13:00:00.000Z" },
      { id: "page-a", now: "2026-11-10T12:00:00.000Z" },
    ];
    for (const seed of seeds) {
      await repository.save(
        makeScan({
          id: seed.id,
          workspaceId: ws,
          storageKey: `quarantine/${WS_PAGES}/${seed.id}.jpg`,
          now: new Date(seed.now),
        }),
      );
    }

    const page1 = await repository.listByWorkspace(ws, { limit: 2 });
    expect(page1.scans.map((s) => s.id)).toEqual(["page-e", "page-d"]);
    expect(page1.hasMore).toBe(true);

    const last1 = page1.scans.at(-1)!;
    const page2 = await repository.listByWorkspace(ws, {
      limit: 2,
      after: { createdAt: last1.createdAt, id: last1.id },
    });
    // Same-instant rows ordered by id desc: page-c then page-b.
    expect(page2.scans.map((s) => s.id)).toEqual(["page-c", "page-b"]);
    expect(page2.hasMore).toBe(true);

    const last2 = page2.scans.at(-1)!;
    const page3 = await repository.listByWorkspace(ws, {
      limit: 2,
      after: { createdAt: last2.createdAt, id: last2.id },
    });
    expect(page3.scans.map((s) => s.id)).toEqual(["page-a"]);
    expect(page3.hasMore).toBe(false);

    // No overlap and no gaps across the walk — every seeded row once.
    const walked = [
      ...page1.scans,
      ...page2.scans,
      ...page3.scans,
    ].map((s) => s.id);
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).toEqual(["page-e", "page-d", "page-c", "page-b", "page-a"]);

    // A cursor past the end yields an empty page, still workspace-scoped.
    const tail = await repository.listByWorkspace(ws, {
      limit: 2,
      after: { createdAt: last2.createdAt, id: last2.id },
    });
    const beyond = await repository.listByWorkspace(ws, {
      limit: 2,
      after: {
        createdAt: page3.scans.at(-1)!.createdAt,
        id: page3.scans.at(-1)!.id,
      },
    });
    expect(tail.scans).toHaveLength(1);
    expect(beyond.scans).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });

  it("listByWorkspace excludes scans whose media was deleted (receipt-retention-30d T6, S6) — first page AND inside a keyset walk", async () => {
    const ws = workspaceId(WS_GONE);
    await repository.save(
      makeScan({
        id: "gone-old",
        workspaceId: ws,
        storageKey: `quarantine/${WS_GONE}/gone-old.jpg`,
        now: new Date("2026-11-10T10:00:00.000Z"),
      }),
    );
    // The deleted row sits in the MIDDLE of the newest-first order:
    // only a real predicate (not a page-trim) removes it.
    await repository.save(
      makeScan({
        id: "gone-mid",
        workspaceId: ws,
        storageKey: `quarantine/${WS_GONE}/gone-mid.jpg`,
        now: new Date("2026-11-10T11:00:00.000Z"),
      }),
    );
    await repository.save(
      makeScan({
        id: "gone-new",
        workspaceId: ws,
        storageKey: `quarantine/${WS_GONE}/gone-new.jpg`,
        now: new Date("2026-11-10T12:00:00.000Z"),
      }),
    );
    const stored = await repository.findById(ws, "gone-mid");
    stored!.markMediaDeleted(new Date("2026-11-15T00:00:00.000Z"));
    await repository.save(stored!);

    const listed = await repository.listByWorkspace(ws, { limit: 50 });
    expect(listed.scans.map((s) => s.id)).toEqual(["gone-new", "gone-old"]);

    // Keyset walk with limit 1: the deleted row is skipped at query
    // level — the cursor keeps working across its position, no gaps,
    // no repeats, and it never appears in any page.
    const page1 = await repository.listByWorkspace(ws, { limit: 1 });
    expect(page1.scans.map((s) => s.id)).toEqual(["gone-new"]);
    expect(page1.hasMore).toBe(true);
    const last = page1.scans.at(-1)!;
    const page2 = await repository.listByWorkspace(ws, {
      limit: 1,
      after: { createdAt: last.createdAt, id: last.id },
    });
    expect(page2.scans.map((s) => s.id)).toEqual(["gone-old"]);
    expect(page2.hasMore).toBe(false);
  });

  it("listMediaPurgeCandidates selects only this workspace's live-media rows at/before the createdAt cutoff, oldest first; stampMediaDeleted marks a row once (receipt-retention-30d T6, S6)", async () => {
    const ws = workspaceId(WS_PURGE);
    const base = new Date("2026-11-30T12:00:00.000Z");
    const DAY = 24 * 60 * 60 * 1000;
    const seed = (id: string, ageDays: number, otherWs = false) =>
      makeScan({
        id,
        workspaceId: otherWs ? workspaceId(WS_B) : ws,
        storageKey: `quarantine/${otherWs ? WS_B : WS_PURGE}/${id}.jpg`,
        now: new Date(base.getTime() - ageDays * DAY),
      });
    await repository.save(seed("purge-20d", 20));
    await repository.save(seed("purge-10d", 10));
    await repository.save(seed("purge-5d", 5));
    // Old but media already gone — never selected again (idempotent).
    const gone = seed("purge-gone", 40);
    gone.markMediaDeleted(new Date(base.getTime() - 5 * DAY));
    await repository.save(gone);
    // Old enough but ANOTHER workspace — the manual purge never
    // reaches across workspaces (S6: user action, workspace-scoped).
    await repository.save(seed("purge-foreign", 40, true));
    // Exactly at the cutoff boundary — `lte` matches the daily job's
    // convention (S6: "older than the window", boundary inclusive).
    await repository.save(seed("purge-edge", 7));
    const cutoff = new Date(base.getTime() - 7 * DAY);

    const candidates = await repository.listMediaPurgeCandidates(
      ws,
      cutoff,
      500,
    );

    expect(candidates.map((c) => c.id)).toEqual([
      "purge-20d",
      "purge-10d",
      "purge-edge",
    ]);
    // Candidates carry the storage key for the object delete.
    expect(candidates[0]?.storageKey).toBe(
      `quarantine/${WS_PURGE}/purge-20d.jpg`,
    );

    // Guarded stamp: first mark wins, a later stamp never overwrites
    // (a concurrent early user DELETE keeps its own timestamp).
    const stampedAt = new Date("2026-11-30T13:00:00.000Z");
    await repository.stampMediaDeleted("purge-10d", stampedAt);
    expect(
      (await repository.findById(ws, "purge-10d"))?.mediaDeletedAt,
    ).toEqual(stampedAt);
    const later = new Date("2026-11-30T14:00:00.000Z");
    await repository.stampMediaDeleted("purge-10d", later);
    expect(
      (await repository.findById(ws, "purge-10d"))?.mediaDeletedAt,
    ).toEqual(stampedAt);
    // And the stamped row drops out of a repeated selection (idempotent).
    expect(
      (await repository.listMediaPurgeCandidates(ws, cutoff, 500)).map(
        (c) => c.id,
      ),
    ).toEqual(["purge-20d", "purge-edge"]);
  });

  it("UNIQUE(workspaceId, fileHash) rejects a second row with the same hash", async () => {
    const hash = "e".repeat(64);
    await repository.save(
      makeScan({ id: "scan-uniq-1", fileHash: hash }),
    );

    await expect(
      repository.save(
        makeScan({
          id: "scan-uniq-2",
          fileHash: hash,
          storageKey: `quarantine/${WS_A}/scan-uniq-2.jpg`,
        }),
      ),
    ).rejects.toThrow();
  });
});
