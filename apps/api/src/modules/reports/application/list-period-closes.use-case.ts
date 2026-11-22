import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { PeriodCloseRepositoryPort } from "./ports/period-close-repository.port.js";
import {
  toPeriodCloseView,
  type PeriodCloseView,
} from "./period-close.view.js";

/**
 * Lists the latest close per period (active rows only), newest period
 * first, with the `stale` flag — the query the monthly report endpoints
 * (T3–T6) and the UI need to decide closed vs provisional periods.
 */
export class ListPeriodClosesUseCase {
  constructor(private readonly closes: PeriodCloseRepositoryPort) {}

  async execute(
    workspaceId: WorkspaceId,
    currency?: string,
  ): Promise<PeriodCloseView[]> {
    const closes = await this.closes.listActive(workspaceId, currency);
    return [...closes]
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .map(toPeriodCloseView);
  }
}
