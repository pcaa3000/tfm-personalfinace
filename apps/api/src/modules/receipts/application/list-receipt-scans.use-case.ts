import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  ReceiptScanListPort,
  ReceiptScanListQuery,
} from "./ports/receipt-scan-repository.port.js";
import { encodeReceiptScanCursor } from "./receipt-scan-cursor.js";
import {
  toReceiptScanListItem,
  type ReceiptScanListItem,
} from "./receipt-scan.view.js";

/**
 * One page of `GET /api/v1/receipts` (receipt-review-link T5, S4):
 * `nextCursor` is the opaque keyset token for the next page — null
 * when this slice reaches the end.
 */
export interface ReceiptScanListPage {
  readonly items: ReceiptScanListItem[];
  readonly nextCursor: string | null;
}

/**
 * Workspace ticket-review list (receipt-review-link T1, S1+S3): every
 * scan in any state, newest first; `transactionId` is null until the
 * scan is confirmed. T5 (S4): cursor pagination — `query.limit` per
 * page, `query.after` the decoded keyset position of the previous
 * page's last item.
 */
export class ListReceiptScansUseCase {
  constructor(private readonly scans: ReceiptScanListPort) {}

  async execute(
    workspaceId: WorkspaceId,
    query: ReceiptScanListQuery,
  ): Promise<ReceiptScanListPage> {
    const slice = await this.scans.listByWorkspace(workspaceId, query);
    const items = slice.scans.map(toReceiptScanListItem);
    const last = slice.scans.at(-1);
    const nextCursor =
      slice.hasMore && last
        ? encodeReceiptScanCursor({
            createdAt: last.createdAt,
            id: last.id,
          })
        : null;
    return { items, nextCursor };
  }
}
