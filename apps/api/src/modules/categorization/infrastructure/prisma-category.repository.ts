import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { CategoryCatalogProvisionerPort } from "../../identity-workspace/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import type { CategoryRepositoryPort } from "../application/ports/category-repository.port.js";
import { Category } from "../domain/category.js";

/** Key of the protected system fallback — it is never copied into a
 *  workspace and stays read-only (T19). */
const UNCATEGORIZED_KEY = "uncategorized";

@Injectable()
export class PrismaCategoryRepository
  implements CategoryRepositoryPort, CategoryCatalogProvisionerPort
{
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

  /**
   * CategoryCatalogProvisionerPort — copies every active global
   * category (except the `uncategorized` fallback) into the workspace
   * as editable rows. Idempotent: keys the workspace already owns
   * (even archived) are skipped, and `skipDuplicates` keeps the
   * (key, workspaceId) unique index safe under races.
   */
  async ensureSeedCategories(workspaceId: WorkspaceId): Promise<void> {
    const globals = await this.prisma.category.findMany({
      where: { workspaceId: null, archivedAt: null },
    });
    const seeds = globals.filter(
      (row) =>
        row.key !== UNCATEGORIZED_KEY && row.nature !== UNCATEGORIZED_KEY,
    );
    if (seeds.length === 0) {
      return;
    }
    const owned = await this.prisma.category.findMany({
      where: { workspaceId: workspaceId.value },
      select: { key: true },
    });
    const ownedKeys = new Set(owned.map((row) => row.key));
    const missing = seeds.filter((row) => !ownedKeys.has(row.key));
    if (missing.length === 0) {
      return;
    }
    await this.prisma.category.createMany({
      data: missing.map((row) => ({
        key: row.key,
        label: row.label,
        nature: row.nature,
        workspaceId: workspaceId.value,
      })),
      skipDuplicates: true,
    });
  }
}
