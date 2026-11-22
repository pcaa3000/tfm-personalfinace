import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Staleness hook for monthly closes (reports-monthly T2, S5): after a
 * revision or void mutates the ledger, every still-valid close whose
 * workspace+currency matches and whose period contains the transaction's
 * businessDate must be marked `invalidatedAt` — closes are never
 * rewritten, only marked stale until re-closed.
 *
 * Implemented by the reports module's Drizzle repository (structural
 * typing) and injected optionally so the use cases keep working when the
 * feature is unwired.
 */
export interface PeriodCloseInvalidationPort {
  invalidateCovering(
    workspaceId: WorkspaceId,
    currency: string,
    businessDate: string,
    invalidatedAt: Date,
  ): Promise<number>;
}

export const PERIOD_CLOSE_INVALIDATION = Symbol("PERIOD_CLOSE_INVALIDATION");
