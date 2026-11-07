import { and, asc, eq, isNull } from "drizzle-orm";

import {
  DomainError,
  Money,
  WorkspaceId,
  type Result,
} from "../../shared-kernel/index.js";
import type { AccountRepositoryPort } from "../application/ports/account-repository.port.js";
import { Account, type AccountKind } from "../domain/account.js";
import { accounts } from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

type AccountRow = typeof accounts.$inferSelect;

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** Drizzle row → domain aggregate (mirrors the prisma repo's local toDomain). */
function toDomain(row: AccountRow): Account {
  const balance = Money.fromMinorUnits(row.initialBalanceMinor, row.currency);
  if (!balance.ok) {
    throw balance.error;
  }
  return Account.reconstitute({
    id: row.id,
    workspaceId: unwrap(WorkspaceId.create(row.workspaceId)),
    name: row.name,
    currency: row.currency,
    kind: row.kind as AccountKind,
    initialBalance: balance.value,
    archivedAt: row.archivedAt,
  });
}

/**
 * Drizzle implementation of {@link AccountRepositoryPort} (spike T2).
 * Mirrors PrismaAccountRepository semantics against the same physical
 * table defined in src/drizzle/schema.ts.
 */
export class DrizzleAccountRepository implements AccountRepositoryPort {
  constructor(private readonly db: DrizzleDb) {}

  async save(account: Account): Promise<void> {
    await this.db
      .insert(accounts)
      .values({
        id: account.id,
        workspaceId: account.workspaceId.value,
        name: account.name,
        currency: account.currency.code,
        kind: account.kind,
        initialBalanceMinor: account.initialBalance.minorUnits,
        archivedAt: account.archivedAt,
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          name: account.name,
          kind: account.kind,
          initialBalanceMinor: account.initialBalance.minorUnits,
          archivedAt: account.archivedAt,
        },
      });
  }

  async list(workspaceId: WorkspaceId): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.workspaceId, workspaceId.value),
          isNull(accounts.archivedAt),
        ),
      )
      .orderBy(asc(accounts.createdAt));
    return rows.map(toDomain);
  }

  async accountCurrency(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.workspaceId, workspaceId.value),
          isNull(accounts.archivedAt),
        ),
      )
      .limit(1);
    return rows[0]?.currency ?? null;
  }

  async findById(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<Account | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.workspaceId, workspaceId.value),
          isNull(accounts.archivedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }
}
