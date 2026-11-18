import { and, eq } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { receiptScans } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import {
  ReceiptScan,
  type ReceiptScanState,
  type ReceiptScanStatus,
} from "../domain/receipt-scan.js";
import type { ReceiptScanRepositoryPort } from "../application/ports/receipt-scan-repository.port.js";

type Row = typeof receiptScans.$inferSelect;

function toState(row: Row): ReceiptScanState {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    uploaderSubject: row.uploaderSubject,
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status as ReceiptScanStatus,
    extractedPayload: row.extractedPayload,
    draftPayload: row.draftPayload,
    transactionId: row.transactionId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Drizzle adapter over `receipts_receipt_scans`. */
export class DrizzleReceiptScanRepository implements ReceiptScanRepositoryPort {
  constructor(private readonly db: DrizzleDb) {}

  async save(scan: ReceiptScan): Promise<void> {
    await this.db
      .insert(receiptScans)
      .values({
        id: scan.id,
        workspaceId: scan.workspaceId.value,
        uploaderSubject: scan.uploaderSubject,
        storageKey: scan.storageKey,
        originalFilename: scan.originalFilename,
        mimeType: scan.mimeType,
        sizeBytes: scan.sizeBytes,
        status: scan.status,
        extractedPayload:
          scan.extractedPayload === null
            ? null
            : (scan.extractedPayload as Record<string, unknown>),
        draftPayload:
          scan.draftPayload === null
            ? null
            : (scan.draftPayload as Record<string, unknown>),
        transactionId: scan.transactionId,
        error: scan.error,
        createdAt: scan.createdAt,
        updatedAt: scan.updatedAt,
      })
      .onConflictDoUpdate({
        target: receiptScans.id,
        set: {
          status: scan.status,
          extractedPayload:
            scan.extractedPayload === null
              ? null
              : (scan.extractedPayload as Record<string, unknown>),
          draftPayload:
            scan.draftPayload === null
              ? null
              : (scan.draftPayload as Record<string, unknown>),
          transactionId: scan.transactionId,
          error: scan.error,
          updatedAt: scan.updatedAt,
        },
      });
  }

  async findById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<ReceiptScan | null> {
    const [row] = await this.db
      .select()
      .from(receiptScans)
      .where(
        and(
          eq(receiptScans.id, id),
          eq(receiptScans.workspaceId, workspaceId.value),
        ),
      )
      .limit(1);
    return row ? ReceiptScan.reconstitute(toState(row)) : null;
  }
}
