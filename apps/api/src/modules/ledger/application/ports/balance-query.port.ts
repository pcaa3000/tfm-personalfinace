import type { WorkspaceId } from "../../../shared-kernel/index.js";

/** Raw per-currency minor-unit totals read by the balance query. */
export interface CurrencyTotals {
  readonly currency: string;
  readonly initialBalanceMinor: bigint;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
}

/**
 * Reads the workspace's per-currency aggregates for the general balance
 * strip: active accounts' initial balances plus confirmed income/expense
 * transactions (transfers are net-0 and excluded). Implemented by an
 * infrastructure SQL aggregation — the use case owns the view mapping.
 */
export interface BalanceQueryPort {
  sumByCurrency(workspaceId: WorkspaceId): Promise<CurrencyTotals[]>;
}
