import { and, asc, desc, eq, isNull, lt, lte, or } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { receiptScans } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import {
  ReceiptScan,
  type ReceiptScanState,
  type ReceiptScanStatus,
} from "../domain/receipt-scan.js";
import type { ReceiptFileHashPort } from "../application/ports/receipt-file-hash.port.js";
import type {
  ReceiptMediaPurgeCandidate,
  ReceiptMediaPurgePort,
  ReceiptScanListPort,
  ReceiptScanListQuery,
  ReceiptScanListSlice,
  ReceiptScanRepositoryPort,
} from "../application/ports/receipt-scan-repository.port.js";

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
    fileHash: row.fileHash,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    mediaDeletedAt: row.mediaDeletedAt,
  };
}

/** Drizzle adapter over `receipts_receipt_scans` (T13: also the fileHash dedup index). */
export class DrizzleReceiptScanRepository
  implements
    ReceiptScanRepositoryPort,
    ReceiptScanListPort,
    ReceiptFileHashPort,
    ReceiptMediaPurgePort
{
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
        fileHash: scan.fileHash,
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
        expiresAt: scan.expiresAt,
        mediaDeletedAt: scan.mediaDeletedAt,
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
          // expiresAt is immutable (fixed at capture) — only the media
          // deletion marker is mutable state on this row.
          mediaDeletedAt: scan.mediaDeletedAt,
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

  /**
   * receipt-review-link T1 (S1) + T5 (S4): newest-first workspace
   * listing with keyset/seek pagination — `ORDER BY createdAt DESC,
   * id DESC` and an exclusive `(createdAt, id) < cursor` predicate, so
   * a concurrent insert can never shift or repeat a client's page the
   * way OFFSET would. Fetches limit+1 to detect `hasMore`.
   * receipt-retention-30d T6 (S6): media-deleted rows are excluded in
   * the WHERE clause, so they never appear in ANY page — including
   * inside a keyset walk.
   */
  async listByWorkspace(
    workspaceId: WorkspaceId,
    query: ReceiptScanListQuery,
  ): Promise<ReceiptScanListSlice> {
    const conditions = [
      eq(receiptScans.workspaceId, workspaceId.value),
      isNull(receiptScans.mediaDeletedAt),
    ];
    if (query.after) {
      const after = query.after;
      const keyset = or(
        lt(receiptScans.createdAt, after.createdAt),
        and(
          eq(receiptScans.createdAt, after.createdAt),
          lt(receiptScans.id, after.id),
        ),
      );
      if (keyset) conditions.push(keyset);
    }
    const rows = await this.db
      .select()
      .from(receiptScans)
      .where(and(...conditions))
      .orderBy(desc(receiptScans.createdAt), desc(receiptScans.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      scans: page.map((row) => ReceiptScan.reconstitute(toState(row))),
      hasMore,
    };
  }

  /**
   * receipt-retention-30d T6 (S6): manual purge selection — this
   * workspace's live-media scans captured at or before the cutoff,
   * oldest first. By `createdAt` (capture age), NOT `expiresAt`: the
   * expiry predicate belongs to the daily cron job.
   */
  async listMediaPurgeCandidates(
    workspaceId: WorkspaceId,
    createdAtCutoff: Date,
    limit: number,
  ): Promise<ReceiptMediaPurgeCandidate[]> {
    return this.db
      .select({ id: receiptScans.id, storageKey: receiptScans.storageKey })
      .from(receiptScans)
      .where(
        and(
          eq(receiptScans.workspaceId, workspaceId.value),
          lte(receiptScans.createdAt, createdAtCutoff),
          isNull(receiptScans.mediaDeletedAt),
        ),
      )
      .orderBy(asc(receiptScans.createdAt))
      .limit(limit);
  }

  /**
   * Guarded media-deletion stamp — identical guard to the daily purge
   * job: `mediaDeletedAt IS NULL` in the UPDATE keeps a concurrent
   * early user DELETE's timestamp from being overwritten.
   */
  async stampMediaDeleted(id: string, at: Date): Promise<void> {
    await this.db
      .update(receiptScans)
      .set({ mediaDeletedAt: at, updatedAt: at })
      .where(
        and(eq(receiptScans.id, id), isNull(receiptScans.mediaDeletedAt)),
      );
  }

  /**
   * T13 (S12): exact-hash dedup lookup — UNIQUE(workspaceId, fileHash)
   * backs this; NULL hashes (pre-T13 rows) never match.
   */
  async findByFileHash(
    workspaceId: WorkspaceId,
    fileHash: string,
  ): Promise<ReceiptScan | null> {
    const [row] = await this.db
      .select()
      .from(receiptScans)
      .where(
        and(
          eq(receiptScans.workspaceId, workspaceId.value),
          eq(receiptScans.fileHash, fileHash),
        ),
      )
      .limit(1);
    return row ? ReceiptScan.reconstitute(toState(row)) : null;
  }
}
