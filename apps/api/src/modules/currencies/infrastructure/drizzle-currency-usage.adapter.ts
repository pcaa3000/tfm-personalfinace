import { and, eq } from "drizzle-orm";

import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CurrencyUsage,
  CurrencyUsagePort,
} from "../application/ports/currency-usage.port.js";
import {
  accounts,
  ledgerTransactions,
} from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

/**
 * Drizzle implementation of {@link CurrencyUsagePort}. Read-only usage
 * projection of a currency code across the workspace: counts every
 * account and transaction that carries the code — active or not —
 * because renaming/removing a used code would corrupt the historical
 * arithmetic (INV-MON-02, INV-MON-04). Like the prisma adapter it reads
 * the accounts/ledger tables directly (cross-module table reads are the
 * established behavior for this projection); it never writes to them.
 */
export class DrizzleCurrencyUsageAdapter implements CurrencyUsagePort {
  constructor(private readonly db: DrizzleDb) {}

  async usageOf(
    workspaceId: WorkspaceId,
    code: string,
  ): Promise<CurrencyUsage> {
    const [accountCount, transactionCount] = await Promise.all([
      this.db.$count(
        accounts,
        and(
          eq(accounts.workspaceId, workspaceId.value),
          eq(accounts.currency, code),
        ),
      ),
      this.db.$count(
        ledgerTransactions,
        and(
          eq(ledgerTransactions.workspaceId, workspaceId.value),
          eq(ledgerTransactions.currency, code),
        ),
      ),
    ]);
    return { accounts: accountCount, transactions: transactionCount };
  }
}
