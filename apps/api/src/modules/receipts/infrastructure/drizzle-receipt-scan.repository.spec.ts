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
const WORKSPACES = [WS_A, WS_B];

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

    const listed = await repository.listByWorkspace(workspaceId(WS_A));

    // Only WS_A rows, newest first.
    expect(listed.every((s) => s.workspaceId.value === WS_A)).toBe(true);
    expect(listed.some((s) => s.id === "scan-list-b")).toBe(false);
    const interest = listed
      .filter((s) => ["scan-list-older", "scan-list-newer"].includes(s.id))
      .map((s) => s.id);
    expect(interest).toEqual(["scan-list-newer", "scan-list-older"]);
    // The persisted transaction link survives reconstitution.
    const newerListed = listed.find((s) => s.id === "scan-list-newer");
    expect(newerListed?.status).toBe("confirmed");
    expect(newerListed?.transactionId).toBe("trx-list-1");
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
