import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { WorkspaceId } from "../../../shared-kernel/index.js";
import type {
  TransactionFilter,
  TransactionRepositoryPort,
} from "../../application/ports/transaction-repository.port.js";
import type { Transaction } from "../../domain/transaction.js";
import { toDomain } from "./transaction.mapper.js";

@Injectable()
export class PrismaTransactionRepository implements TransactionRepositoryPort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: workspaceId.value,
          idempotencyKey,
        },
      },
      include: { revisions: { orderBy: { revisionNumber: "asc" } } },
    });
    return row ? toDomain(row) : null;
  }

  async findById(workspaceId: WorkspaceId, id: string): Promise<Transaction | null> {
    const row = await this.prisma.transaction.findFirst({
      where: { id, workspaceId: workspaceId.value },
      include: { revisions: { orderBy: { revisionNumber: "asc" } } },
    });
    return row ? toDomain(row) : null;
  }

  async save(transaction: Transaction): Promise<void> {
    const latest = transaction.revisions[transaction.revisions.length - 1];
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.upsert({
        where: { id: transaction.id },
        create: {
          id: transaction.id,
          workspaceId: transaction.workspaceId.value,
          idempotencyKey: transaction.idempotencyKey,
          type: transaction.type,
          amountMinor: transaction.amount.minorUnits,
          currency: transaction.amount.currency.code,
          businessDate: new Date(`${transaction.businessDate.isoDate}T00:00:00Z`),
          timezone: transaction.businessDate.timezone,
          concept: transaction.concept,
          accountId: transaction.accountId,
          categoryId:
            transaction.category.kind === "categorized"
              ? transaction.category.categoryId
              : null,
          status: transaction.status,
          origin: transaction.origin,
          originRef: transaction.originReference,
          confirmedAt: transaction.confirmedAt,
          confirmedBy: transaction.confirmedBy,
        },
        update: {
          type: transaction.type,
          amountMinor: transaction.amount.minorUnits,
          currency: transaction.amount.currency.code,
          businessDate: new Date(`${transaction.businessDate.isoDate}T00:00:00Z`),
          timezone: transaction.businessDate.timezone,
          concept: transaction.concept,
          accountId: transaction.accountId,
          categoryId:
            transaction.category.kind === "categorized"
              ? transaction.category.categoryId
              : null,
          status: transaction.status,
        },
      });
      if (latest) {
        await tx.transactionRevision.createMany({
          data: {
            id: latest.id,
            transactionId: transaction.id,
            revisionNumber: latest.revisionNumber,
            kind: latest.kind,
            changes: latest.changes as object[],
            occurredAt: latest.occurredAt,
            actor: latest.actor,
          },
          skipDuplicates: true,
        });
      }
    });
  }

  async list(workspaceId: WorkspaceId, filter: TransactionFilter): Promise<Transaction[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        workspaceId: workspaceId.value,
        ...(filter.from || filter.to
          ? {
              businessDate: {
                ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}),
                ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.currency ? { currency: filter.currency } : {}),
        ...(filter.category === "uncategorized"
          ? { categoryId: null }
          : filter.category
            ? { categoryId: filter.category }
            : {}),
        ...(filter.q
          ? { concept: { contains: filter.q, mode: "insensitive" as const } }
          : {}),
      },
      include: { revisions: { orderBy: { revisionNumber: "asc" } } },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(toDomain);
  }
}
