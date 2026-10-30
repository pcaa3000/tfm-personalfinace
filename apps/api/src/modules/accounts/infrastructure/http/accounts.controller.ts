import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import {
  CALLER_RESOLVER,
  WORKSPACE_CONTEXT,
  type CallerResolverPort,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import { DomainError } from "../../../shared-kernel/index.js";
import { CreateAccountUseCase } from "../../application/create-account.use-case.js";
import { ListAccountsUseCase } from "../../application/list-accounts.use-case.js";

const createAccountSchema = z.object({
  name: z.string().min(1).max(64),
  currency: z.string().length(3),
  kind: z.enum(["bank", "cash", "wallet"]).default("bank"),
});

type RequestHeaders = Record<string, string | string[] | undefined>;

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
  ) {}

  @Get()
  async list(@Headers() headers: RequestHeaders): Promise<unknown> {
    const caller = await this.callerResolver.resolve(headers);
    if (!caller) {
      throw new HttpException(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const context = await this.workspaceContext.resolve(caller);
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
    const caller = await this.callerResolver.resolve(headers);
    if (!caller) {
      throw new HttpException(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const context = await this.workspaceContext.resolve(caller);
    const result = await this.createAccount.execute({
      workspaceId: context.workspaceId,
      name: parsed.data.name,
      currency: parsed.data.currency,
      kind: parsed.data.kind,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }
}
