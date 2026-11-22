import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type { PeriodClose } from "../../domain/period-close.js";

/**
 * Persistence port for period closes (reports-monthly T2, S5). Rows are
 * append-mostly: `save` upserts by id; `listActive`/`findActiveByPeriod`
 * expose only the latest close per period (`supersededAt IS NULL`) — the
 * provisional-close reports (T3–T6) consume this view to decide whether
 * a period is closed, stale or still provisional.
 */
export interface PeriodCloseRepositoryPort {
  findActiveByPeriod(
    workspaceId: WorkspaceId,
    currency: string,
    periodStart: string,
  ): Promise<PeriodClose | null>;

  /** Latest close per period, newest period first; optional currency filter. */
  listActive(
    workspaceId: WorkspaceId,
    currency?: string,
  ): Promise<PeriodClose[]>;

  /**
   * Marks `invalidatedAt` on every still-valid close whose period
   * contains `businessDate` (YYYY-MM-DD) — the staleness hook called by
   * ledger revise/void. Already-invalidated or superseded rows are
   * untouched. Returns the number of rows marked.
   */
  invalidateCovering(
    workspaceId: WorkspaceId,
    currency: string,
    businessDate: string,
    invalidatedAt: Date,
  ): Promise<number>;

  save(close: PeriodClose): Promise<void>;
}

export const PERIOD_CLOSE_REPOSITORY = Symbol("PERIOD_CLOSE_REPOSITORY");
