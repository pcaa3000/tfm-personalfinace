import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { CategoryValidationPort } from "../../ledger/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CategoryCatalogPort,
  CategoryView,
} from "../application/category-catalog.port.js";

/**
 * Implements the ledger-owned CategoryValidationPort and the read-side
 * CategoryCatalogPort: a category is usable when it is an active global
 * entry or belongs to the caller's workspace.
 */
@Injectable()
export class PrismaCategoryValidationAdapter
  implements CategoryValidationPort, CategoryCatalogPort
{
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async existsForWorkspace(workspaceId: WorkspaceId, categoryId: string): Promise<boolean> {
    const count = await this.prisma.category.count({
      where: {
        id: categoryId,
        archivedAt: null,
        OR: [{ workspaceId: null }, { workspaceId: workspaceId.value }],
      },
    });
    return count > 0;
  }

  async listForWorkspace(workspaceId: WorkspaceId): Promise<CategoryView[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        archivedAt: null,
        OR: [{ workspaceId: null }, { workspaceId: workspaceId.value }],
      },
      orderBy: { key: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      nature: row.nature,
      custom: row.workspaceId !== null,
    }));
  }
}
