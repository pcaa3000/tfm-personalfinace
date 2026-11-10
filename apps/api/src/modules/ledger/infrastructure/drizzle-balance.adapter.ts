import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  BalanceQueryPort,
  CurrencyTotals,
} from "../application/ports/balance-query.port.js";

interface RawRow {
  [key: string]: unknown;
  currency: string;
  initial_minor: string | number;
  income_minor: string | number;
  expense_minor: string | number;
}

/**
 * One grouped UNION over `accounts_accounts` + `ledger_transactions`:
 * active accounts contribute their initial balance; confirmed
 * income/expense rows contribute signed buckets. Transfers and voided
 * rows are filtered out before aggregation, matching `summarizeByCurrency`.
 */
export class DrizzleBalanceAdapter implements BalanceQueryPort {
  constructor(private readonly db: DrizzleDb) {}

  async sumByCurrency(workspaceId: WorkspaceId): Promise<CurrencyTotals[]> {
    const result = await this.db.execute<RawRow>(sql`
      SELECT currency,
             SUM(initial_minor) AS initial_minor,
             SUM(income_minor) AS income_minor,
             SUM(expense_minor) AS expense_minor
      FROM (
        SELECT a.currency, a."initialBalanceMinor" AS initial_minor,
               0::bigint AS income_minor, 0::bigint AS expense_minor
        FROM accounts_accounts a
        WHERE a."workspaceId" = ${workspaceId.value}
          AND a."archivedAt" IS NULL
        UNION ALL
        SELECT t.currency, 0::bigint,
               CASE WHEN t.type = 'income' THEN t."amountMinor" ELSE 0::bigint END,
               CASE WHEN t.type = 'expense' THEN t."amountMinor" ELSE 0::bigint END
        FROM ledger_transactions t
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.status = 'confirmed'
          AND t.type IN ('income', 'expense')
      ) rows
      GROUP BY currency
      ORDER BY currency
    `);
    return result.rows.map((row) => ({
      currency: row.currency,
      initialBalanceMinor: BigInt(row.initial_minor as string | number),
      incomeMinor: BigInt(row.income_minor as string | number),
      expenseMinor: BigInt(row.expense_minor as string | number),
    }));
  }
}
