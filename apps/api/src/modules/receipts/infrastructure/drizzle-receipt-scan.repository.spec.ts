import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { createDrizzleDb } from "../../../drizzle/db.js";
import { receiptScans } from "../../../drizzle/schema.js";
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
}> = {}): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: overrides.id ?? "scan-spec-1",
    workspaceId: overrides.workspaceId ?? workspaceId(WS_A),
    uploaderSubject: "user-1",
    storageKey: overrides.storageKey ?? `quarantine/${WS_A}/scan-spec-1.jpg`,
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    now: new Date("2026-11-10T12:00:00.000Z"),
  });
  if (!scan.ok) throw scan.error;
  return scan.value;
}

async function cleanupAll(db: ReturnType<typeof createDrizzleDb>["db"]) {
  await db
    .delete(receiptScans)
    .where(inArray(receiptScans.workspaceId, WORKSPACES));
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
});
