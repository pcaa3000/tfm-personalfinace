import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import {
  CALLER_RESOLVER,
  WORKSPACE_CONTEXT,
  type CallerIdentity,
  type CallerResolverPort,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import { DomainError } from "../../../shared-kernel/index.js";
import { ArchiveAccountUseCase } from "../../application/archive-account.use-case.js";
import { CreateAccountUseCase } from "../../application/create-account.use-case.js";
import { ListAccountsUseCase } from "../../application/list-accounts.use-case.js";
import { ReviseAccountUseCase } from "../../application/revise-account.use-case.js";

const KINDS = [
  "cash",
  "bank",
  "savings",
  "credit_card",
  "virtual",
  "investment",
  "loan",
  "insurance",
] as const;

const createAccountSchema = z.object({
  name: z.string().min(1).max(64),
  currency: z.string().length(3),
  kind: z.enum(KINDS).default("bank"),
  initialBalance: z.string().min(1).max(48).optional(),
});

const reviseAccountSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    kind: z.enum(KINDS).optional(),
    initialBalance: z.string().min(1).max(48).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.kind !== undefined ||
      data.initialBalance !== undefined,
  );

type RequestHeaders = Record<string, string | string[] | undefined>;

function unauthenticated(): HttpException {
  return new HttpException(
    { code: "UNAUTHENTICATED", message: "Authentication required" },
    HttpStatus.UNAUTHORIZED,
  );
}

function toHttpError(error: DomainError): HttpException {
  const notFound = error.code.endsWith("_NOT_FOUND");
  const conflict = error.code.endsWith("_TAKEN");
  return new HttpException(
    { code: error.code, message: error.message },
    notFound
      ? HttpStatus.NOT_FOUND
      : conflict
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST,
  );
}

@Controller("api/v1/accounts")
export class AccountsController {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly callerResolver: CallerResolverPort,
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(CreateAccountUseCase)
    private readonly createAccount: CreateAccountUseCase,
    @Inject(ListAccountsUseCase)
    private readonly listAccounts: ListAccountsUseCase,
    @Inject(ReviseAccountUseCase)
    private readonly reviseAccount: ReviseAccountUseCase,
    @Inject(ArchiveAccountUseCase)
    private readonly archiveAccount: ArchiveAccountUseCase,
  ) {}

  private async authenticatedCaller(
    headers: RequestHeaders,
  ): Promise<CallerIdentity> {
    const caller = await this.callerResolver.resolve(headers);
    if (!caller) {
      throw unauthenticated();
    }
    return caller;
  }

  @Get()
  async list(@Headers() headers: RequestHeaders): Promise<unknown> {
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    return this.listAccounts.execute(context.workspaceId);
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid account payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.createAccount.execute({
      workspaceId: context.workspaceId,
      name: parsed.data.name,
      currency: parsed.data.currency,
      kind: parsed.data.kind,
      ...(parsed.data.initialBalance !== undefined
        ? { initialBalance: parsed.data.initialBalance }
        : {}),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }

  @Patch(":id")
  async revise(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const parsed = reviseAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid account revision payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.reviseAccount.execute({
      workspaceId: context.workspaceId,
      accountId: id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.initialBalance !== undefined
        ? { initialBalance: parsed.data.initialBalance }
        : {}),
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }

  @Post(":id/archive")
  async archive(
    @Param("id") id: string,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.archiveAccount.execute({
      workspaceId: context.workspaceId,
      accountId: id,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }
}
