import type { WorkspaceId } from "../../../shared-kernel/index.js";

/**
 * Raw per-account cash-flow totals for a resolved period
 * (reports-monthly T3, S1). `accountId === null` is the explicit
 * "unassigned" group for legacy rows without an account; the account
 * columns are then null too.
 */
export interface CashFlowAccountTotals {
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly accountKind: string | null;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly transfersInMinor: bigint;
  readonly transfersOutMinor: bigint;
}

/**
 * Read port for the cash-flow report: confirmed, non-voided ledger rows
 * in `currency` whose `businessDate` lies inside the inclusive
 * [from, to] window, grouped by account. Transfers contribute only to
 * the transfersIn/transfersOut buckets (CA-023) — never to income or
 * expense.
 */
export interface CashFlowReportQueryPort {
  totalsPerAccount(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<CashFlowAccountTotals[]>;
}

export const CASH_FLOW_REPORT_QUERY = Symbol("CASH_FLOW_REPORT_QUERY");
