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
import { AddCurrencyUseCase } from "../../application/add-currency.use-case.js";
import { ArchiveCurrencyUseCase } from "../../application/archive-currency.use-case.js";
import { ListCurrenciesUseCase } from "../../application/list-currencies.use-case.js";
import { ListIsoCatalogUseCase } from "../../application/list-iso-catalog.use-case.js";
import { ReviseCurrencyUseCase } from "../../application/revise-currency.use-case.js";

const currencyCodeSchema = z.object({
  code: z.string().length(3),
});

type RequestHeaders = Record<string, string | string[] | undefined>;

/** Generic 401 — never reveals whether the account exists. */
function unauthenticated(): HttpException {
  return new HttpException(
    { code: "UNAUTHENTICATED", message: "Authentication required" },
    HttpStatus.UNAUTHORIZED,
  );
}

const CONFLICT_CODES = new Set([
  "CURRENCY_CODE_TAKEN",
  "CURRENCY_IN_USE",
  "CURRENCY_IS_DEFAULT",
  "CURRENCY_LAST_ACTIVE",
]);

function toHttpError(error: DomainError): HttpException {
  const notFound = error.code.endsWith("_NOT_FOUND");
  const conflict = error.code.endsWith("_TAKEN") || CONFLICT_CODES.has(error.code);
  return new HttpException(
    { code: error.code, message: error.message },
    notFound
      ? HttpStatus.NOT_FOUND
      : conflict
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST,
  );
}

@Controller("api/v1/currencies")
export class CurrenciesController {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly callerResolver: CallerResolverPort,
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(AddCurrencyUseCase)
    private readonly addCurrency: AddCurrencyUseCase,
    @Inject(ListCurrenciesUseCase)
    private readonly listCurrencies: ListCurrenciesUseCase,
    @Inject(ListIsoCatalogUseCase)
    private readonly listIsoCatalog: ListIsoCatalogUseCase,
    @Inject(ReviseCurrencyUseCase)
    private readonly reviseCurrency: ReviseCurrencyUseCase,
    @Inject(ArchiveCurrencyUseCase)
    private readonly archiveCurrency: ArchiveCurrencyUseCase,
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
    return this.listCurrencies.execute(context.workspaceId);
  }

  /** Full ISO 4217 table for the searchable currency selector (L21). */
  @Get("catalog")
  async catalog(@Headers() headers: RequestHeaders): Promise<unknown> {
    await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    return this.listIsoCatalog.execute();
  }

  @Post()
  async add(
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const parsed = currencyCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid currency payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.addCurrency.execute({
      workspaceId: context.workspaceId,
      code: parsed.data.code,
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
    const parsed = currencyCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid currency revision payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.reviseCurrency.execute({
      workspaceId: context.workspaceId,
      currencyId: id,
      code: parsed.data.code,
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
    const result = await this.archiveCurrency.execute({
      workspaceId: context.workspaceId,
      currencyId: id,
      defaultCurrency: context.defaultCurrency,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }
}
