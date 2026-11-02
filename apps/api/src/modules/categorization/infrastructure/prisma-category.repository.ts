import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type { CategoryRepositoryPort } from "../application/ports/category-repository.port.js";
import { Category } from "../domain/category.js";

@Injectable()
export class PrismaCategoryRepository implements CategoryRepositoryPort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async save(category: Category): Promise<void> {
    await this.prisma.category.upsert({
      where: { id: category.id },
      create: {
        id: category.id,
        key: category.key,
        label: category.label,
        nature: category.nature,
        workspaceId: category.workspaceId.value,
        archivedAt: category.archivedAt,
      },
      update: {
        label: category.label,
        nature: category.nature,
        archivedAt: category.archivedAt,
      },
    });
  }

  async findOwnedById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<Category | null> {
    const row = await this.prisma.category.findFirst({
      where: { id, workspaceId: workspaceId.value, archivedAt: null },
    });
    if (!row) return null;
    const category = Category.reconstitute({
      id: row.id,
      workspaceId: row.workspaceId ?? "",
      key: row.key,
      label: row.label,
      nature: row.nature,
      archivedAt: row.archivedAt,
    });
    if (!category.ok) throw category.error;
    return category.value;
  }

  async existsKey(workspaceId: WorkspaceId, key: string): Promise<boolean> {
    const count = await this.prisma.category.count({
      where: { key, workspaceId: workspaceId.value },
    });
    return count > 0;
  }
}
