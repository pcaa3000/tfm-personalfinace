import {
  and,
  desc,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { ledgerTransactions } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { ReceiptDraftPossibleDuplicate } from "../domain/receipt-draft.js";
import type {
  TransactionDuplicateCriteria,
  TransactionDuplicatesPort,
} from "../application/ports/transaction-duplicates.port.js";

/**
 * Semantic duplicate candidates for the receipt draft review
 * (receipt-scan-drafts T13, S12 — "nivel 3"): confirmed `expense`
 * transactions in the workspace whose ABSOLUTE amount equals the draft
 * total AND that match the businessDate window OR the merchant text
 * (ILIKE against `concept`). Like `DrizzleCurrencyUsageAdapter` it
 * reads the ledger table directly (cross-module table reads are the
 * established behavior for projections); it never writes to it.
 */
export class DrizzleTransactionDuplicatesAdapter
  implements TransactionDuplicatesPort
{
  constructor(private readonly db: DrizzleDb) {}

  async findExpenseCandidates(
    workspaceId: WorkspaceId,
    criteria: TransactionDuplicateCriteria,
  ): Promise<ReceiptDraftPossibleDuplicate[]> {
    const semantic: SQL[] = [];
    if (criteria.fromDate && criteria.toDate) {
      semantic.push(
        gte(
          ledgerTransactions.businessDate,
          new Date(`${criteria.fromDate}T00:00:00Z`),
        ),
        lte(
          ledgerTransactions.businessDate,
          new Date(`${criteria.toDate}T23:59:59.999Z`),
        ),
      );
    }
    if (criteria.merchant) {
      semantic.push(
        ilike(ledgerTransactions.concept, `%${criteria.merchant}%`),
      );
    }
    if (semantic.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        id: ledgerTransactions.id,
        concept: ledgerTransactions.concept,
        amountMinor: ledgerTransactions.amountMinor,
        businessDate: ledgerTransactions.businessDate,
      })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.workspaceId, workspaceId.value),
          eq(ledgerTransactions.type, "expense"),
          // "voidedAt IS NULL" of the spec == the non-voided status here.
          eq(ledgerTransactions.status, "confirmed"),
          sql`abs(${ledgerTransactions.amountMinor}) = ${BigInt(criteria.amountMinorUnits)}`,
          or(...semantic),
        ),
      )
      .orderBy(desc(ledgerTransactions.businessDate));

    return rows.map((row) => ({
      transactionId: row.id,
      concept: row.concept,
      amount: Number(row.amountMinor),
      occurredOn: row.businessDate.toISOString().slice(0, 10),
    }));
  }
}
