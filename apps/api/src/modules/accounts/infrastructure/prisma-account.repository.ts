import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { Money, WorkspaceId } from "../../shared-kernel/index.js";
import type { AccountRepositoryPort } from "../application/ports/account-repository.port.js";
import { Account, type AccountKind } from "../domain/account.js";

@Injectable()
export class PrismaAccountRepository implements AccountRepositoryPort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async save(account: Account): Promise<void> {
    await this.prisma.account.upsert({
      where: { id: account.id },
      create: {
        id: account.id,
        workspaceId: account.workspaceId.value,
        name: account.name,
        currency: account.currency.code,
        kind: account.kind,
        initialBalanceMinor: account.initialBalance.minorUnits,
      },
      update: {
        name: account.name,
        kind: account.kind,
        initialBalanceMinor: account.initialBalance.minorUnits,
        archivedAt: account.archivedAt,
      },
    });
  }

  async list(workspaceId: WorkspaceId): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({
      where: { workspaceId: workspaceId.value, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async accountCurrency(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<string | null> {
    const row = await this.prisma.account.findFirst({
      where: { id: accountId, workspaceId: workspaceId.value, archivedAt: null },
      select: { currency: true },
    });
    return row?.currency ?? null;
  }

  async findById(
    workspaceId: WorkspaceId,
    accountId: string,
  ): Promise<Account | null> {
    const row = await this.prisma.account.findFirst({
      where: { id: accountId, workspaceId: workspaceId.value, archivedAt: null },
    });
    return row ? toDomain(row) : null;
  }
}

interface AccountRow {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  kind: string;
  initialBalanceMinor: bigint;
  archivedAt: Date | null;
}

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

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
