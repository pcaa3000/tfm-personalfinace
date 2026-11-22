import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CashFlowAccountTotals,
  CashFlowReportQueryPort,
} from "../application/ports/cash-flow-report.port.js";

interface RawRow {
  [key: string]: unknown;
  account_key: string | null;
  account_name: string | null;
  account_kind: string | null;
  income_minor: string | number;
  expense_minor: string | number;
  transfers_in_minor: string | number;
  transfers_out_minor: string | number;
}

/**
 * Drizzle adapter for {@link CashFlowReportQueryPort} (reports-monthly
 * T3, S1): one grouped UNION over `ledger_transactions` —
 * income/expense rows credit their `accountId`, transfers credit
 * `accountId` (out) and `destinationAccountId` (in) separately so they
 * never land in income/expense (CA-023). NULL account ids aggregate
 * into the unassigned group; the LEFT JOIN carries its name/kind as
 * null.
 */
export class DrizzleCashFlowReportAdapter implements CashFlowReportQueryPort {
  constructor(private readonly db: DrizzleDb) {}

  async totalsPerAccount(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<CashFlowAccountTotals[]> {
    const result = await this.db.execute<RawRow>(sql`
      SELECT lines.account_key AS account_key,
             a.name AS account_name,
             a.kind AS account_kind,
             SUM(lines.income_minor) AS income_minor,
             SUM(lines.expense_minor) AS expense_minor,
             SUM(lines.transfers_in_minor) AS transfers_in_minor,
             SUM(lines.transfers_out_minor) AS transfers_out_minor
      FROM (
        SELECT t."accountId" AS account_key,
               CASE WHEN t.type = 'income' THEN t."amountMinor" ELSE 0::bigint END AS income_minor,
               CASE WHEN t.type = 'expense' THEN t."amountMinor" ELSE 0::bigint END AS expense_minor,
               0::bigint AS transfers_in_minor,
               0::bigint AS transfers_out_minor
        FROM ledger_transactions t
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.currency = ${currency}
          AND t.status = 'confirmed'
          AND t.type IN ('income', 'expense')
          AND t."businessDate" >= ${from}::date
          AND t."businessDate" <= ${to}::date
        UNION ALL
        SELECT t."accountId",
               0::bigint, 0::bigint, 0::bigint,
               t."amountMinor"
        FROM ledger_transactions t
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.currency = ${currency}
          AND t.status = 'confirmed'
          AND t.type = 'transfer'
          AND t."businessDate" >= ${from}::date
          AND t."businessDate" <= ${to}::date
        UNION ALL
        SELECT t."destinationAccountId",
               0::bigint, 0::bigint,
               t."amountMinor",
               0::bigint
        FROM ledger_transactions t
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.currency = ${currency}
          AND t.status = 'confirmed'
          AND t.type = 'transfer'
          AND t."businessDate" >= ${from}::date
          AND t."businessDate" <= ${to}::date
      ) lines
      LEFT JOIN accounts_accounts a ON a.id = lines.account_key
      GROUP BY lines.account_key, a.name, a.kind
    `);
    return result.rows.map((row) => ({
      accountId: row.account_key,
      accountName: row.account_name,
      accountKind: row.account_kind,
      incomeMinor: BigInt(row.income_minor),
      expenseMinor: BigInt(row.expense_minor),
      transfersInMinor: BigInt(row.transfers_in_minor),
      transfersOutMinor: BigInt(row.transfers_out_minor),
    }));
  }
}
