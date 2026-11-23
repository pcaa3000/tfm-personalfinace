import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  AvoidableExpenseLine,
  AvoidableExpensesReportQueryPort,
} from "../application/ports/avoidable-expenses-report.port.js";

interface RawLineRow {
  [key: string]: unknown;
  transaction_id: string;
  merchant: string | null;
  category_id: string;
  category_key: string | null;
  category_label: string | null;
  amount_minor: string | number;
}

interface RawIncomeRow {
  [key: string]: unknown;
  income_minor: string | number;
}

/**
 * Drizzle adapter for {@link AvoidableExpensesReportQueryPort}
 * (reports-monthly T5, S3): eligible lines are confirmed, non-voided
 * `expense` rows in the window whose head `categoryId` joins a
 * `discretionary` category — the INNER JOIN itself excludes NULL
 * categoryIds and every non-discretionary nature, so uncategorized
 * spend never enters the discretionary universe. Income is the period's
 * confirmed `income` total used by the 1%-of-income mean check.
 */
export class DrizzleAvoidableExpensesReportAdapter
  implements AvoidableExpensesReportQueryPort
{
  constructor(private readonly db: DrizzleDb) {}

  async discretionaryExpenseLines(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<AvoidableExpenseLine[]> {
    const result = await this.db.execute<RawLineRow>(sql`
      SELECT t.id AS transaction_id,
             t.merchant AS merchant,
             t."categoryId" AS category_id,
             c.key AS category_key,
             c.label AS category_label,
             t."amountMinor" AS amount_minor
      FROM ledger_transactions t
      JOIN categorization_categories c ON c.id = t."categoryId"
      WHERE t."workspaceId" = ${workspaceId.value}
        AND t.currency = ${currency}
        AND t.status = 'confirmed'
        AND t.type = 'expense'
        AND t."businessDate" >= ${from}::date
        AND t."businessDate" <= ${to}::date
        AND c.nature = 'discretionary'
      ORDER BY t.id
    `);
    return result.rows.map((row) => ({
      transactionId: row.transaction_id,
      merchant: row.merchant,
      categoryId: row.category_id,
      categoryKey: row.category_key,
      categoryLabel: row.category_label,
      amountMinor: BigInt(row.amount_minor),
    }));
  }

  async confirmedIncomeMinor(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<bigint> {
    const result = await this.db.execute<RawIncomeRow>(sql`
      SELECT COALESCE(SUM(t."amountMinor"), 0) AS income_minor
      FROM ledger_transactions t
      WHERE t."workspaceId" = ${workspaceId.value}
        AND t.currency = ${currency}
        AND t.status = 'confirmed'
        AND t.type = 'income'
        AND t."businessDate" >= ${from}::date
        AND t."businessDate" <= ${to}::date
    `);
    return BigInt(result.rows[0]?.income_minor ?? 0);
  }
}
