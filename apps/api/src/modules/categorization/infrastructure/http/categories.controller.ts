import { Controller, Get, Headers, Inject } from "@nestjs/common";

import {
  callerFromHeaders,
  WORKSPACE_CONTEXT,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import {
  CATEGORY_CATALOG,
  type CategoryCatalogPort,
} from "../../application/category-catalog.port.js";

@Controller("api/v1/categories")
export class CategoriesController {
  constructor(
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(CATEGORY_CATALOG) private readonly catalog: CategoryCatalogPort,
  ) {}

  @Get()
  async list(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    const context = await this.workspaceContext.resolve(
      callerFromHeaders(headers),
    );
    return this.catalog.listForWorkspace(context.workspaceId);
  }
}
