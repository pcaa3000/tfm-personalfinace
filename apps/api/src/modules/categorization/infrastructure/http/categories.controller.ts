import { Controller, Get, Inject } from "@nestjs/common";

import {
  WORKSPACE_CONTEXT,
  type WorkspaceContextPort,
} from "../../../identity-workspace/index.js";
import {
  CATEGORY_CATALOG,
  type CategoryCatalogPort,
} from "../../application/category-catalog.port.js";

const LOCAL_CALLER = { issuer: "local", subject: "dev-user" } as const;

@Controller("api/v1/categories")
export class CategoriesController {
  constructor(
    @Inject(WORKSPACE_CONTEXT) private readonly workspaceContext: WorkspaceContextPort,
    @Inject(CATEGORY_CATALOG) private readonly catalog: CategoryCatalogPort,
  ) {}

  @Get()
  async list(): Promise<unknown> {
    const context = await this.workspaceContext.resolve(LOCAL_CALLER);
    return this.catalog.listForWorkspace(context.workspaceId);
  }
}
