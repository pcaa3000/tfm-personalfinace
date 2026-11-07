import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { CategoryCatalogProvisionerPort } from "../../identity-workspace/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type { CategoryRepositoryPort } from "../application/ports/category-repository.port.js";
import { Category } from "../domain/category.js";
import { categories } from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

/** Key of the protected system fallback — it is never copied into a
 *  workspace and stays read-only (T19). */
const UNCATEGORIZED_KEY = "uncategorized";

/**
 * Drizzle implementation of {@link CategoryRepositoryPort} and
 * {@link CategoryCatalogProvisionerPort}. Mirrors
 * PrismaCategoryRepository semantics against the same physical table
 * defined in src/drizzle/schema.ts.
 */
export class DrizzleCategoryRepository
  implements CategoryRepositoryPort, CategoryCatalogProvisionerPort
{
  constructor(private readonly db: DrizzleDb) {}

  async save(category: Category): Promise<void> {
    await this.db
      .insert(categories)
      .values({
        id: category.id,
        key: category.key,
        label: category.label,
        nature: category.nature,
        workspaceId: category.workspaceId.value,
        archivedAt: category.archivedAt,
      })
      .onConflictDoUpdate({
        target: categories.id,
        set: {
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
    const rows = await this.db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, id),
          eq(categories.workspaceId, workspaceId.value),
          isNull(categories.archivedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const category = Category.reconstitute({
      id: row.id,
      workspaceId: row.workspaceId ?? "",
      key: row.key,
      label: row.label,
      nature: row.nature,
      archivedAt: row.archivedAt,
    });
    if (!category.ok) {
      throw category.error;
    }
    return category.value;
  }

  async existsKey(workspaceId: WorkspaceId, key: string): Promise<boolean> {
    const count = await this.db.$count(
      categories,
      and(
        eq(categories.key, key),
        eq(categories.workspaceId, workspaceId.value),
      ),
    );
    return count > 0;
  }

  /**
   * CategoryCatalogProvisionerPort — copies every active global
   * category (except the `uncategorized` fallback, matched on key OR
   * nature) into the workspace as editable rows. Idempotent: keys the
   * workspace already owns (even archived) are skipped, and
   * `onConflictDoNothing` keeps the (key, workspaceId) unique index
   * safe under races — the Drizzle equivalent of Prisma's
   * `createMany({ skipDuplicates: true })`.
   */
  async ensureSeedCategories(workspaceId: WorkspaceId): Promise<void> {
    const globals = await this.db
      .select()
      .from(categories)
      .where(
        and(isNull(categories.workspaceId), isNull(categories.archivedAt)),
      );
    const seeds = globals.filter(
      (row) =>
        row.key !== UNCATEGORIZED_KEY && row.nature !== UNCATEGORIZED_KEY,
    );
    if (seeds.length === 0) {
      return;
    }
    const owned = await this.db
      .select({ key: categories.key })
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId.value));
    const ownedKeys = new Set(owned.map((row) => row.key));
    const missing = seeds.filter((row) => !ownedKeys.has(row.key));
    if (missing.length === 0) {
      return;
    }
    await this.db
      .insert(categories)
      .values(
        missing.map((row) => ({
          // Prisma generated the uuid client-side; the column has no
          // database default, so Drizzle must supply the id.
          id: randomUUID(),
          key: row.key,
          label: row.label,
          nature: row.nature,
          workspaceId: workspaceId.value,
        })),
      )
      .onConflictDoNothing();
  }
}
