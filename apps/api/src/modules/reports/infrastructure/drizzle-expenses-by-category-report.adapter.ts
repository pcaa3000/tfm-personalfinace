import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  ExpenseCategoryTotals,
  ExpensesByCategoryReportQueryPort,
} from "../application/ports/expenses-by-category-report.port.js";

interface RawRow {
  [key: string]: unknown;
  category_id: string | null;
  category_key: string | null;
  category_label: string | null;
  nature: string | null;
  total_minor: string | number;
  transaction_count: string | number;
}

/**
 * Drizzle adapter for {@link ExpensesByCategoryReportQueryPort}
 * (reports-monthly T4, S2): expense lines are the SPLITS when a
 * transaction has them (INV-TRX-SPLIT-01 — each split attributed to its
 * own categoryId, the head category ignored) and the head row otherwise.
 * `transaction_count` counts DISTINCT transactions so a split
 * transaction contributes once per category it touches.
 */
export class DrizzleExpensesByCategoryReportAdapter
  implements ExpensesByCategoryReportQueryPort
{
  constructor(private readonly db: DrizzleDb) {}

  async totalsPerCategory(
    workspaceId: WorkspaceId,
    currency: string,
    from: string,
    to: string,
  ): Promise<ExpenseCategoryTotals[]> {
    const result = await this.db.execute<RawRow>(sql`
      SELECT lines.category_id AS category_id,
             c.key AS category_key,
             c.label AS category_label,
             c.nature AS nature,
             SUM(lines.amount_minor) AS total_minor,
             COUNT(DISTINCT lines.transaction_id) AS transaction_count
      FROM (
        SELECT s."categoryId" AS category_id,
               s."amountMinor" AS amount_minor,
               t.id AS transaction_id
        FROM ledger_transactions t
        JOIN ledger_transaction_splits s ON s."transactionId" = t.id
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.currency = ${currency}
          AND t.status = 'confirmed'
          AND t.type = 'expense'
          AND t."businessDate" >= ${from}::date
          AND t."businessDate" <= ${to}::date
        UNION ALL
        SELECT t."categoryId",
               t."amountMinor",
               t.id
        FROM ledger_transactions t
        WHERE t."workspaceId" = ${workspaceId.value}
          AND t.currency = ${currency}
          AND t.status = 'confirmed'
          AND t.type = 'expense'
          AND t."businessDate" >= ${from}::date
          AND t."businessDate" <= ${to}::date
          AND NOT EXISTS (
            SELECT 1 FROM ledger_transaction_splits s2
            WHERE s2."transactionId" = t.id
          )
      ) lines
      LEFT JOIN categorization_categories c ON c.id = lines.category_id
      GROUP BY lines.category_id, c.key, c.label, c.nature
    `);
    return result.rows.map((row) => ({
      categoryId: row.category_id,
      categoryKey: row.category_key,
      categoryLabel: row.category_label,
      nature: row.nature,
      totalMinor: BigInt(row.total_minor),
      transactionCount: Number(row.transaction_count),
    }));
  }
}
