import {
  and,
  desc,
  eq,
  gte,
  isNull,
  lte,
  type SQL,
} from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { periodCloses } from "../../../drizzle/schema.js";
import { WorkspaceId } from "../../shared-kernel/index.js";
import { PeriodClose } from "../domain/period-close.js";
import type { PeriodCloseRepositoryPort } from "../application/ports/period-close-repository.port.js";

type PeriodCloseRow = typeof periodCloses.$inferSelect;

/**
 * Drizzle adapter for {@link PeriodCloseRepositoryPort}. It also
 * structurally satisfies the ledger module's
 * `PeriodCloseInvalidationPort` via `invalidateCovering`, so the
 * composition root wires one instance into both the report use cases and
 * the transaction revise/void use cases.
 */
export class DrizzlePeriodCloseRepository
  implements PeriodCloseRepositoryPort
{
  constructor(private readonly db: DrizzleDb) {}

  private toDomain(row: PeriodCloseRow): PeriodClose {
    const workspaceId = WorkspaceId.create(row.workspaceId);
    if (!workspaceId.ok) throw workspaceId.error;
    return PeriodClose.reconstitute({
      id: row.id,
      workspaceId: workspaceId.value,
      currency: row.currency,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      timezone: row.timezone,
      integrityDeclared: row.integrityDeclared,
      closedAt: row.closedAt,
      invalidatedAt: row.invalidatedAt,
      supersededAt: row.supersededAt,
      createdAt: row.createdAt,
    });
  }

  async findActiveByPeriod(
    workspaceId: WorkspaceId,
    currency: string,
    periodStart: string,
  ): Promise<PeriodClose | null> {
    const rows = await this.db
      .select()
      .from(periodCloses)
      .where(
        and(
          eq(periodCloses.workspaceId, workspaceId.value),
          eq(periodCloses.currency, currency),
          eq(periodCloses.periodStart, new Date(`${periodStart}T00:00:00Z`)),
          isNull(periodCloses.supersededAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async listActive(
    workspaceId: WorkspaceId,
    currency?: string,
  ): Promise<PeriodClose[]> {
    const conditions: SQL[] = [
      eq(periodCloses.workspaceId, workspaceId.value),
      isNull(periodCloses.supersededAt),
    ];
    if (currency !== undefined) {
      conditions.push(eq(periodCloses.currency, currency));
    }
    const rows = await this.db
      .select()
      .from(periodCloses)
      .where(and(...conditions))
      .orderBy(desc(periodCloses.periodStart));
    return rows.map((row) => this.toDomain(row));
  }

  async invalidateCovering(
    workspaceId: WorkspaceId,
    currency: string,
    businessDate: string,
    invalidatedAt: Date,
  ): Promise<number> {
    const day = new Date(`${businessDate}T00:00:00Z`);
    const result = await this.db
      .update(periodCloses)
      .set({ invalidatedAt })
      .where(
        and(
          eq(periodCloses.workspaceId, workspaceId.value),
          eq(periodCloses.currency, currency),
          isNull(periodCloses.supersededAt),
          isNull(periodCloses.invalidatedAt),
          lte(periodCloses.periodStart, day),
          gte(periodCloses.periodEnd, day),
        ),
      );
    return result.rowCount ?? 0;
  }

  async save(close: PeriodClose): Promise<void> {
    const asDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
    await this.db
      .insert(periodCloses)
      .values({
        id: close.id,
        workspaceId: close.workspaceId.value,
        currency: close.currency,
        periodStart: asDate(close.periodStart),
        periodEnd: asDate(close.periodEnd),
        timezone: close.timezone,
        integrityDeclared: close.integrityDeclared,
        closedAt: close.closedAt,
        invalidatedAt: close.invalidatedAt,
        supersededAt: close.supersededAt,
        createdAt: close.createdAt,
      })
      .onConflictDoUpdate({
        target: periodCloses.id,
        set: {
          invalidatedAt: close.invalidatedAt,
          supersededAt: close.supersededAt,
        },
      });
  }
}
