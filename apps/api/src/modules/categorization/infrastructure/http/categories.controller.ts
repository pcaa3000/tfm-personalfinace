import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";

import {
  CALLER_RESOLVER,
  WORKSPACE_CONTEXT,
  type CallerResolverPort,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import {
  CATEGORY_CATALOG,
  type CategoryCatalogPort,
} from "../../application/category-catalog.port.js";

@Controller("api/v1/categories")
export class CategoriesController {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly callerResolver: CallerResolverPort,
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(CATEGORY_CATALOG) private readonly catalog: CategoryCatalogPort,
  ) {}

  @Get()
  async list(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    const caller = await this.callerResolver.resolve(headers);
    if (!caller) {
      throw new HttpException(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const context = await this.workspaceContext.resolve(caller);
    return this.catalog.listForWorkspace(context.workspaceId);
  }
}
