import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { CategoryValidationPort } from "../../ledger/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";

/**
 * Implements the ledger-owned CategoryValidationPort: a category is usable
 * when it is an active global entry or belongs to the caller's workspace.
 */
@Injectable()
export class PrismaCategoryValidationAdapter implements CategoryValidationPort {
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
}
