import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { CurrencyEnabledPort } from "../../accounts/index.js";
import type { WorkspaceCatalogProvisionerPort } from "../../identity-workspace/index.js";
import type { CurrencyRepositoryPort } from "../application/ports/currency-repository.port.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";

/**
 * Persists the workspace currency catalog and implements the
 * consumer-owned ports: `CurrencyEnabledPort` (accounts, INV-MON-03)
 * and `WorkspaceCatalogProvisionerPort` (identity-workspace bootstrap).
 */
@Injectable()
export class PrismaCurrencyRepository
  implements
    CurrencyRepositoryPort,
    CurrencyEnabledPort,
    WorkspaceCatalogProvisionerPort
{
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async save(currency: WorkspaceCurrency): Promise<void> {
    await this.prisma.currency.upsert({
      where: { id: currency.id },
      create: {
        id: currency.id,
        workspaceId: currency.workspaceId.value,
        code: currency.code.code,
        archivedAt: currency.archivedAt,
      },
      update: {
        code: currency.code.code,
        archivedAt: currency.archivedAt,
      },
    });
  }

  async listActive(workspaceId: WorkspaceId): Promise<WorkspaceCurrency[]> {
    const rows = await this.prisma.currency.findMany({
      where: { workspaceId: workspaceId.value, archivedAt: null },
      orderBy: { code: "asc" },
    });
    return rows.map(toDomain);
  }

  async findActiveById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<WorkspaceCurrency | null> {
    const row = await this.prisma.currency.findFirst({
      where: { id, workspaceId: workspaceId.value, archivedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async existsCode(workspaceId: WorkspaceId, code: string): Promise<boolean> {
    const count = await this.prisma.currency.count({
      where: { workspaceId: workspaceId.value, code },
    });
    return count > 0;
  }

  async countActive(workspaceId: WorkspaceId): Promise<number> {
    return this.prisma.currency.count({
      where: { workspaceId: workspaceId.value, archivedAt: null },
    });
  }

  /** CurrencyEnabledPort — INV-MON-03. */
  async isEnabled(workspaceId: WorkspaceId, code: string): Promise<boolean> {
    const count = await this.prisma.currency.count({
      where: { workspaceId: workspaceId.value, code, archivedAt: null },
    });
    return count > 0;
  }

  /**
   * WorkspaceCatalogProvisionerPort — seeds a freshly created workspace
   * with its default currency (bootstrap, INV-MON-01..03).
   */
  async ensureDefaultCurrency(
    workspaceId: WorkspaceId,
    code: string,
  ): Promise<void> {
    await this.prisma.currency.upsert({
      where: {
        workspaceId_code: { workspaceId: workspaceId.value, code },
      },
      create: { workspaceId: workspaceId.value, code },
      update: {},
    });
  }
}

interface CurrencyRow {
  id: string;
  workspaceId: string;
  code: string;
  archivedAt: Date | null;
}

function toDomain(row: CurrencyRow): WorkspaceCurrency {
  const workspaceId = WorkspaceId.create(row.workspaceId);
  if (!workspaceId.ok) {
    throw workspaceId.error;
  }
  return WorkspaceCurrency.reconstitute({
    id: row.id,
    workspaceId: workspaceId.value,
    code: row.code,
    archivedAt: row.archivedAt,
  });
}
