import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { CurrencyEnabledPort } from "../../accounts/index.js";
import type { WorkspaceCatalogProvisionerPort } from "../../identity-workspace/index.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import type { CurrencyRepositoryPort } from "../application/ports/currency-repository.port.js";
import { WorkspaceCurrency } from "../domain/workspace-currency.js";
import { currencies } from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

type CurrencyRow = typeof currencies.$inferSelect;

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

/**
 * Drizzle implementation of {@link CurrencyRepositoryPort},
 * {@link CurrencyEnabledPort} (INV-MON-03) and
 * {@link WorkspaceCatalogProvisionerPort} (workspace bootstrap).
 * Mirrors PrismaCurrencyRepository against src/drizzle/schema.ts.
 *
 * NOTE: Prisma's `@updatedAt` is applied client-side — Drizzle does not
 * bump the column automatically, so every update path sets `updatedAt`
 * explicitly to keep parity.
 */
export class DrizzleCurrencyRepository
  implements
    CurrencyRepositoryPort,
    CurrencyEnabledPort,
    WorkspaceCatalogProvisionerPort
{
  constructor(private readonly db: DrizzleDb) {}

  async save(currency: WorkspaceCurrency): Promise<void> {
    await this.db
      .insert(currencies)
      .values({
        id: currency.id,
        workspaceId: currency.workspaceId.value,
        code: currency.code.code,
        archivedAt: currency.archivedAt,
      })
      .onConflictDoUpdate({
        target: currencies.id,
        set: {
          code: currency.code.code,
          archivedAt: currency.archivedAt,
          // Prisma @updatedAt equivalent — drizzle does not auto-update.
          updatedAt: new Date(),
        },
      });
  }

  async listActive(workspaceId: WorkspaceId): Promise<WorkspaceCurrency[]> {
    const rows = await this.db
      .select()
      .from(currencies)
      .where(
        and(
          eq(currencies.workspaceId, workspaceId.value),
          isNull(currencies.archivedAt),
        ),
      )
      .orderBy(asc(currencies.code));
    return rows.map(toDomain);
  }

  async findActiveById(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<WorkspaceCurrency | null> {
    const rows = await this.db
      .select()
      .from(currencies)
      .where(
        and(
          eq(currencies.id, id),
          eq(currencies.workspaceId, workspaceId.value),
          isNull(currencies.archivedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async existsCode(workspaceId: WorkspaceId, code: string): Promise<boolean> {
    const count = await this.db.$count(
      currencies,
      and(
        eq(currencies.workspaceId, workspaceId.value),
        eq(currencies.code, code),
      ),
    );
    return count > 0;
  }

  async countActive(workspaceId: WorkspaceId): Promise<number> {
    return this.db.$count(
      currencies,
      and(
        eq(currencies.workspaceId, workspaceId.value),
        isNull(currencies.archivedAt),
      ),
    );
  }

  /** CurrencyEnabledPort — INV-MON-03. */
  async isEnabled(workspaceId: WorkspaceId, code: string): Promise<boolean> {
    const count = await this.db.$count(
      currencies,
      and(
        eq(currencies.workspaceId, workspaceId.value),
        eq(currencies.code, code),
        isNull(currencies.archivedAt),
      ),
    );
    return count > 0;
  }

  /**
   * WorkspaceCatalogProvisionerPort — seeds a freshly created workspace
   * with its default currency (bootstrap, INV-MON-01..03). Upserts on
   * the (workspaceId, code) unique index like the prisma version; the
   * conflict update only bumps updatedAt because Prisma's `update: {}`
   * still applies @updatedAt while leaving every other column untouched.
   */
  async ensureDefaultCurrency(
    workspaceId: WorkspaceId,
    code: string,
  ): Promise<void> {
    await this.db
      .insert(currencies)
      .values({
        // Prisma generated the uuid client-side; the column has no
        // database default, so Drizzle must supply the id.
        id: randomUUID(),
        workspaceId: workspaceId.value,
        code,
      })
      .onConflictDoUpdate({
        target: [currencies.workspaceId, currencies.code],
        set: { updatedAt: new Date() },
      });
  }
}
