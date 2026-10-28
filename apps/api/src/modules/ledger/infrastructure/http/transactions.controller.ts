import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";

import {
  WORKSPACE_CONTEXT,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import { DomainError } from "../../../shared-kernel/index.js";
import { ListTransactionRevisionsUseCase } from "../../application/list-transaction-revisions.use-case.js";
import { ListTransactionsUseCase } from "../../application/list-transactions.use-case.js";
import { RecordManualTransactionUseCase } from "../../application/record-manual-transaction.use-case.js";
import { ReviseTransactionUseCase } from "../../application/revise-transaction.use-case.js";
import { VoidTransactionUseCase } from "../../application/void-transaction.use-case.js";
import type { TransactionFilter } from "../../application/ports/transaction-repository.port.js";

const createTransactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.string().min(1).max(48),
  currency: z.string().length(3),
  businessDate: z.string().min(10).max(10),
  timezone: z.string().min(1).max(64),
  concept: z.string().min(1).max(500),
  categoryId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const reviseTransactionSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  amount: z.string().min(1).max(48).optional(),
  currency: z.string().length(3).optional(),
  businessDate: z.string().min(10).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  concept: z.string().min(1).max(500).optional(),
  categoryId: z.string().nullable().optional(),
});

const listTransactionsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.enum(["income", "expense"]).optional(),
  currency: z.string().length(3).optional(),
  category: z.string().optional(),
});

const LOCAL_CALLER = { issuer: "local", subject: "dev-user" } as const;

function toHttpError(error: DomainError): HttpException {
  const notFound = error.code.endsWith("_NOT_FOUND");
  return new HttpException(
    { code: error.code, message: error.message },
    notFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
  );
}

@Controller("api/v1/transactions")
export class TransactionsController {
  constructor(
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(RecordManualTransactionUseCase)
    private readonly recordManual: RecordManualTransactionUseCase,
    @Inject(ListTransactionsUseCase)
    private readonly listTransactions: ListTransactionsUseCase,
    @Inject(ReviseTransactionUseCase)
    private readonly reviseTransaction: ReviseTransactionUseCase,
    @Inject(VoidTransactionUseCase)
    private readonly voidTransaction: VoidTransactionUseCase,
    @Inject(ListTransactionRevisionsUseCase)
    private readonly listRevisions: ListTransactionRevisionsUseCase,
  ) {}

  @Post()
  async create(@Body() body: unknown): Promise<unknown> {
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid transaction payload",
        details: parsed.error.issues,
      });
    }

    const idempotencyKey = parsed.data.idempotencyKey;
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An idempotencyKey is required to create a transaction",
      });
    }

    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    const result = await this.recordManual.execute({
      workspaceId: context.workspaceId,
      idempotencyKey,
      type: parsed.data.type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      businessDate: parsed.data.businessDate,
      timezone: parsed.data.timezone,
      concept: parsed.data.concept,
      categoryId: parsed.data.categoryId ?? null,
      actor: LOCAL_CALLER.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }

  @Get()
  async list(@Query() query: unknown): Promise<unknown> {
    const parsed = listTransactionsSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_QUERY",
        message: "Invalid list filters",
        details: parsed.error.issues,
      });
    }

    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    const filter: TransactionFilter = {};
    if (parsed.data.from) Object.assign(filter, { from: parsed.data.from });
    if (parsed.data.to) Object.assign(filter, { to: parsed.data.to });
    if (parsed.data.type) Object.assign(filter, { type: parsed.data.type });
    if (parsed.data.currency) Object.assign(filter, { currency: parsed.data.currency });
    if (parsed.data.category) Object.assign(filter, { category: parsed.data.category });

    return this.listTransactions.execute(context.workspaceId, filter);
  }

  @Patch(":id")
  async revise(@Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const parsed = reviseTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid revision payload",
        details: parsed.error.issues,
      });
    }

    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    const result = await this.reviseTransaction.execute({
      workspaceId: context.workspaceId,
      transactionId: id,
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.currency !== undefined
        ? { currency: parsed.data.currency }
        : {}),
      ...(parsed.data.businessDate !== undefined
        ? { businessDate: parsed.data.businessDate }
        : {}),
      ...(parsed.data.timezone !== undefined
        ? { timezone: parsed.data.timezone }
        : {}),
      ...(parsed.data.concept !== undefined
        ? { concept: parsed.data.concept }
        : {}),
      ...(parsed.data.categoryId !== undefined
        ? { categoryId: parsed.data.categoryId }
        : {}),
      actor: LOCAL_CALLER.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }

  @Post(":id/void")
  async void(@Param("id") id: string): Promise<unknown> {
    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    const result = await this.voidTransaction.execute({
      workspaceId: context.workspaceId,
      transactionId: id,
      actor: LOCAL_CALLER.subject,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }

  @Get(":id/revisions")
  async revisions(@Param("id") id: string): Promise<unknown> {
    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    const result = await this.listRevisions.execute(context.workspaceId, id);
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }
}
