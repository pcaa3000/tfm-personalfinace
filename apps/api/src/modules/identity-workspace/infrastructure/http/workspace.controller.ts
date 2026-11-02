import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Patch,
} from "@nestjs/common";
import { z } from "zod";

import {
  CALLER_RESOLVER,
  WORKSPACE_CONTEXT,
  type CallerIdentity,
  type CallerResolverPort,
  type WorkspaceContextPort,
} from "../../index.js";
import { DomainError } from "../../../shared-kernel/index.js";
import { UpdateWorkspacePreferencesUseCase } from "../../application/update-workspace-preferences.use-case.js";

const updateSchema = z
  .object({
    defaultCurrency: z.string().length(3).optional(),
    locale: z.string().min(2).max(35).optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .refine(
    (data) =>
      data.defaultCurrency !== undefined ||
      data.locale !== undefined ||
      data.timezone !== undefined,
  );

type RequestHeaders = Record<string, string | string[] | undefined>;

@Controller("api/v1/workspace")
export class WorkspaceController {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly callerResolver: CallerResolverPort,
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(UpdateWorkspacePreferencesUseCase)
    private readonly updatePreferences: UpdateWorkspacePreferencesUseCase,
  ) {}

  private async caller(headers: RequestHeaders): Promise<CallerIdentity> {
    const caller = await this.callerResolver.resolve(headers);
    if (!caller) {
      throw new HttpException(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return caller;
  }

  @Get()
  async get(@Headers() headers: RequestHeaders): Promise<unknown> {
    const caller = await this.caller(headers);
    const context = await this.workspaceContext.resolve(caller);
    return {
      workspaceId: context.workspaceId.value,
      locale: context.locale,
      timezone: context.timezone,
      defaultCurrency: context.defaultCurrency,
    };
  }

  @Patch()
  async update(
    @Body() body: unknown,
    @Headers() headers: RequestHeaders,
  ): Promise<unknown> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: "Invalid workspace payload",
        details: parsed.error.issues,
      });
    }
    const caller = await this.caller(headers);
    const context = await this.workspaceContext.resolve(caller);
    const result = await this.updatePreferences.execute(context.workspaceId, {
      ...(parsed.data.defaultCurrency !== undefined
        ? { defaultCurrency: parsed.data.defaultCurrency }
        : {}),
      ...(parsed.data.locale !== undefined
        ? { locale: parsed.data.locale }
        : {}),
      ...(parsed.data.timezone !== undefined
        ? { timezone: parsed.data.timezone }
        : {}),
    });
    if (!result.ok) {
      const error: DomainError = result.error;
      throw new HttpException(
        { code: error.code, message: error.message },
        error.code.endsWith("_NOT_FOUND") ? 404 : 400,
      );
    }
    const value = result.value;
    return {
      workspaceId: value.workspaceId.value,
      locale: value.locale,
      timezone: value.timezone,
      defaultCurrency: value.defaultCurrency,
    };
  }
}
