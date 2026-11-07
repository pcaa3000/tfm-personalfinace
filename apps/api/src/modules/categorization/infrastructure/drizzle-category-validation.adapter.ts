import { and, asc, eq, isNull, or } from "drizzle-orm";

import type { CategoryValidationPort } from "../../ledger/index.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CategoryCatalogPort,
  CategoryView,
} from "../application/category-catalog.port.js";
import { categories } from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

/**
 * Drizzle implementation of the ledger-owned CategoryValidationPort and
 * the read-side CategoryCatalogPort: a category is usable when it is an
 * active global entry or belongs to the caller's workspace. Mirrors
 * PrismaCategoryValidationAdapter against src/drizzle/schema.ts.
 */
export class DrizzleCategoryValidationAdapter
  implements CategoryValidationPort, CategoryCatalogPort
{
  constructor(private readonly db: DrizzleDb) {}

  async existsForWorkspace(
    workspaceId: WorkspaceId,
    categoryId: string,
  ): Promise<boolean> {
    const count = await this.db.$count(
      categories,
      and(
        eq(categories.id, categoryId),
        isNull(categories.archivedAt),
        or(
          isNull(categories.workspaceId),
          eq(categories.workspaceId, workspaceId.value),
        ),
      ),
    );
    return count > 0;
  }

  async listForWorkspace(workspaceId: WorkspaceId): Promise<CategoryView[]> {
    const rows = await this.db
      .select()
      .from(categories)
      .where(
        and(
          isNull(categories.archivedAt),
          or(
            isNull(categories.workspaceId),
            eq(categories.workspaceId, workspaceId.value),
          ),
        ),
      )
      .orderBy(asc(categories.key));
    // Shadowing (T19): a workspace-owned row hides the global with the
    // same key whatever its archivedAt — otherwise an archived copy
    // would let the global reappear in the list. The owned-keys read
    // deliberately does NOT filter archivedAt.
    const owned = await this.db
      .select({ key: categories.key })
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId.value));
    const shadowedKeys = new Set(owned.map((row) => row.key));
    return rows
      .filter(
        (row) => row.workspaceId !== null || !shadowedKeys.has(row.key),
      )
      .map((row) => ({
        id: row.id,
        key: row.key,
        label: row.label,
        nature: row.nature,
        custom: row.workspaceId !== null,
      }));
  }
}
