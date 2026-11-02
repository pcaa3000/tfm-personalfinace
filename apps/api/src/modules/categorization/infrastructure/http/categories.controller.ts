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
import { ArchiveCategoryUseCase } from "../../application/archive-category.use-case.js";
import { CreateCategoryUseCase } from "../../application/create-category.use-case.js";
import { ReviseCategoryUseCase } from "../../application/revise-category.use-case.js";
import {
  CATEGORY_CATALOG,
  type CategoryCatalogPort,
} from "../../application/category-catalog.port.js";

const NATURES = [
  "income",
  "essential",
  "discretionary",
  "obligation",
  "transfer",
] as const;

const createCategorySchema = z.object({
  key: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(120),
  nature: z.enum(NATURES),
});

const reviseCategorySchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    nature: z.enum(NATURES).optional(),
  })
  .refine((data) => data.label !== undefined || data.nature !== undefined);

type RequestHeaders = Record<string, string | string[] | undefined>;

/** Generic 401 — never reveals whether the account exists. */
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

@Controller("api/v1/categories")
export class CategoriesController {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly callerResolver: CallerResolverPort,
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(CATEGORY_CATALOG) private readonly catalog: CategoryCatalogPort,
    @Inject(CreateCategoryUseCase)
    private readonly createCategory: CreateCategoryUseCase,
    @Inject(ReviseCategoryUseCase)
    private readonly reviseCategory: ReviseCategoryUseCase,
    @Inject(ArchiveCategoryUseCase)
    private readonly archiveCategory: ArchiveCategoryUseCase,
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
    return this.catalog.listForWorkspace(context.workspaceId);
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid category payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.createCategory.execute({
      workspaceId: context.workspaceId,
      ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
      label: parsed.data.label,
      nature: parsed.data.nature,
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
    const parsed = reviseCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid category revision payload",
        details: parsed.error.issues,
      });
    }
    const context = await this.workspaceContext.resolve(
      await this.authenticatedCaller(headers),
    );
    const result = await this.reviseCategory.execute({
      workspaceId: context.workspaceId,
      categoryId: id,
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.nature !== undefined
        ? { nature: parsed.data.nature }
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
    const result = await this.archiveCategory.execute({
      workspaceId: context.workspaceId,
      categoryId: id,
    });
    if (!result.ok) {
      throw toHttpError(result.error);
    }
    return result.value;
  }
}
