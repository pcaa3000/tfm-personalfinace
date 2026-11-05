import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient, type Workspace } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  WorkspacePreferencesPatch,
  WorkspaceSettingsPort,
} from "../application/update-workspace-preferences.use-case.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";
import {
  WORKSPACE_CATALOG_PROVISIONER,
  type WorkspaceCatalogProvisionerPort,
} from "../application/workspace-catalog-provisioner.port.js";
import {
  CATEGORY_SEED_PROVISIONER,
  type CategoryCatalogProvisionerPort,
} from "../application/category-catalog-provisioner.port.js";

/**
 * Deterministic adapter for local development: resolves (and lazily creates)
 * one workspace per caller identity key "issuer|subject". The caller arrives
 * through the x-dev-user header until the OIDC adapter (Supabase Auth) lands
 * in Corte 4 — the port contract and use cases do not change.
 *
 * On creation it also seeds the workspace currency catalog with the
 * default currency through the currencies-owned provisioner port
 * (INV-MON-01..03 bootstrap) and copies the editable seed categories
 * through the categorization-owned provisioner port (T19).
 */
@Injectable()
export class DeterministicWorkspaceAdapter
  implements WorkspaceContextPort, WorkspaceSettingsPort
{
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(WORKSPACE_CATALOG_PROVISIONER)
    private readonly catalog: WorkspaceCatalogProvisionerPort,
    @Inject(CATEGORY_SEED_PROVISIONER)
    private readonly seedCategories?: CategoryCatalogProvisionerPort,
  ) {}

  async resolve(caller: CallerIdentity): Promise<WorkspaceContext> {
    const identityKey = `${caller.issuer}|${caller.subject}`;
    const found = await this.prisma.workspace.findUnique({
      where: { identityKey },
    });
    const workspace = found ?? (await this.createWorkspace(identityKey));

    const workspaceId = WorkspaceId.create(workspace.id);
    if (!workspaceId.ok) {
      throw workspaceId.error;
    }

    return {
      workspaceId: workspaceId.value,
      locale: workspace.locale,
      timezone: workspace.timezone,
      defaultCurrency: workspace.defaultCurrency,
    };
  }

  /** Creates the workspace and seeds its currency catalog with the default. */
  private async createWorkspace(identityKey: string): Promise<Workspace> {
    try {
      const workspace = await this.prisma.workspace.create({
        data: {
          identityKey,
          kind: "personal",
          locale: "en-US",
          timezone: "UTC",
          defaultCurrency: "PEN",
        },
      });
      const workspaceId = WorkspaceId.create(workspace.id);
      if (!workspaceId.ok) {
        throw workspaceId.error;
      }
      await this.catalog.ensureDefaultCurrency(
        workspaceId.value,
        workspace.defaultCurrency,
      );
      await this.seedCategories?.ensureSeedCategories(workspaceId.value);
      return workspace;
    } catch (error) {
      // A concurrent first request won the create; re-read the row.
      const existing = await this.prisma.workspace.findUnique({
        where: { identityKey },
      });
      if (existing) {
        return existing;
      }
      throw error;
    }
  }

  async updatePreferences(
    workspaceId: WorkspaceId,
    patch: WorkspacePreferencesPatch,
  ): Promise<WorkspaceContext> {
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId.value },
      data: patch,
    });
    return {
      workspaceId,
      locale: workspace.locale,
      timezone: workspace.timezone,
      defaultCurrency: workspace.defaultCurrency,
    };
  }
}
