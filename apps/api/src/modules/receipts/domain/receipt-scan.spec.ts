import { describe, expect, it } from "vitest";

import { WorkspaceId } from "../../shared-kernel/index.js";
import {
  RECEIPT_MEDIA_RETENTION_DAYS,
  ReceiptScan,
  type ReceiptScanState,
} from "./receipt-scan.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const NOW = new Date("2026-11-10T12:00:00.000Z");

function quarantined(now: Date = NOW): ReceiptScan {
  const scan = ReceiptScan.quarantine({
    id: "scan-1",
    workspaceId: WS,
    uploaderSubject: "user-1",
    storageKey: "quarantine/ws-1/scan-1.jpg",
    originalFilename: "ticket.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    fileHash: "a".repeat(64),
    now,
  });
  if (!scan.ok) throw scan.error;
  return scan.value;
}

describe("ReceiptScan media retention (receipt-retention-30d T1, S1+S2)", () => {
  it("quarantine stamps expiresAt = createdAt + 30 days — fixed, not configurable (S1)", async () => {
    const scan = quarantined();

    expect(RECEIPT_MEDIA_RETENTION_DAYS).toBe(30);
    expect(scan.createdAt).toEqual(NOW);
    expect(scan.expiresAt.getTime()).toBe(
      NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    // Fresh quarantine media exists — nothing deleted yet.
    expect(scan.mediaDeletedAt).toBeNull();
  });

  it("markMediaDeleted records the deletion instant and bumps updatedAt (S3)", async () => {
    const scan = quarantined();
    const deleted = new Date("2026-11-15T08:30:00.000Z");

    scan.markMediaDeleted(deleted);

    expect(scan.mediaDeletedAt).toEqual(deleted);
    expect(scan.updatedAt).toEqual(deleted);
    // The scan row itself is untouched — CA-012: the confirmed
    // transaction and the scan row survive media deletion.
    expect(scan.status).toBe("pending");
  });

  it("reconstitute restores expiresAt and mediaDeletedAt from persisted state", async () => {
    const state: ReceiptScanState = {
      id: "scan-9",
      workspaceId: WS.value,
      uploaderSubject: "user-1",
      storageKey: "quarantine/ws-1/scan-9.jpg",
      originalFilename: "ticket.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 42,
      status: "confirmed",
      extractedPayload: null,
      draftPayload: null,
      transactionId: "trx-1",
      fileHash: "b".repeat(64),
      error: null,
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-20T10:00:00.000Z"),
      expiresAt: new Date("2026-10-31T10:00:00.000Z"),
      mediaDeletedAt: new Date("2026-10-20T10:00:00.000Z"),
    };

    const scan = ReceiptScan.reconstitute(state);

    expect(scan.expiresAt).toEqual(state.expiresAt);
    expect(scan.mediaDeletedAt).toEqual(state.mediaDeletedAt);
  });
});
