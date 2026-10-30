import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
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
      },
      update: {
        name: account.name,
        archivedAt: account.archivedAt,
      },
    });
  }

  async list(workspaceId: WorkspaceId): Promise<Account[]> {
    const rows = await this.prisma.account.findMany({
      where: { workspaceId: workspaceId.value, archivedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) =>
      Account.reconstitute({
        id: row.id,
        workspaceId: unwrap(WorkspaceId.create(row.workspaceId)),
        name: row.name,
        currency: row.currency,
        kind: row.kind as AccountKind,
        archivedAt: row.archivedAt,
      }),
    );
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
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
