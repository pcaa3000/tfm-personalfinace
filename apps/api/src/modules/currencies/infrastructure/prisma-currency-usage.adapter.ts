import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CurrencyUsage,
  CurrencyUsagePort,
} from "../application/ports/currency-usage.port.js";

/**
 * Read-only usage projection of a currency code across the workspace.
 * Counts every account and transaction that carries the code — active
 * or not — because renaming/removing a used code would corrupt the
 * historical arithmetic (INV-MON-02, INV-MON-04). It never writes to
 * the accounts/ledger tables.
 */
@Injectable()
export class PrismaCurrencyUsageAdapter implements CurrencyUsagePort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async usageOf(
    workspaceId: WorkspaceId,
    code: string,
  ): Promise<CurrencyUsage> {
    const [accounts, transactions] = await Promise.all([
      this.prisma.account.count({
        where: { workspaceId: workspaceId.value, currency: code },
      }),
      this.prisma.transaction.count({
        where: { workspaceId: workspaceId.value, currency: code },
      }),
    ]);
    return { accounts, transactions };
  }
}
