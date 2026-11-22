import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  MonthlySavingsReportQueryPort,
  MonthlySavingsTotals,
} from "../application/ports/monthly-savings-report.port.js";

interface RawRow {
  [key: string]: unknown;
  income_minor: string | number;
  expense_minor: string | number;
}

/**
 * Drizzle adapter for {@link MonthlySavingsReportQueryPort}
 * (reports-monthly T6, S4): one conditional aggregate over confirmed,
 * non-voided `income`/`expense` rows in the window — expenses of every
 * nature including uncategorized, transfers excluded.
 */
export class DrizzleMonthlySavingsReportAdapter
  implements MonthlySavingsReportQueryPort
{
  constructor(private readonly db: DrizzleDb) {}

  async incomeExpenseTotals(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<MonthlySavingsTotals> {
    const result = await this.db.execute<RawRow>(sql`
      SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t."amountMinor" END), 0) AS income_minor,
             COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t."amountMinor" END), 0) AS expense_minor
      FROM ledger_transactions t
      WHERE t."workspaceId" = ${workspaceId.value}
        AND t.currency = ${currency}
        AND t.status = 'confirmed'
        AND t.type IN ('income', 'expense')
        AND t."businessDate" >= ${from}::date
        AND t."businessDate" <= ${to}::date
    `);
    const row = result.rows[0];
    return {
      incomeMinor: BigInt(row?.income_minor ?? 0),
      expenseMinor: BigInt(row?.expense_minor ?? 0),
    };
  }
}
