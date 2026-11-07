import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  type DomainError,
  type Result,
  WorkspaceId,
} from "../../shared-kernel/index.js";
import type {
  WorkspacePreferencesPatch,
  WorkspaceSettingsPort,
} from "../application/update-workspace-preferences.use-case.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";
import type { WorkspaceCatalogProvisionerPort } from "../application/workspace-catalog-provisioner.port.js";
import type { CategoryCatalogProvisionerPort } from "../application/category-catalog-provisioner.port.js";
import { workspaces } from "../../../drizzle/schema.js";
import type { DrizzleDb } from "../../../drizzle/db.js";

type WorkspaceRow = typeof workspaces.$inferSelect;

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/**
 * Drizzle implementation of {@link WorkspaceContextPort} and
 * {@link WorkspaceSettingsPort}. Mirrors DeterministicWorkspaceAdapter:
 * resolves (and lazily creates) one workspace per caller identity key
 * "issuer|subject", seeds the workspace currency catalog with the
 * default currency and copies the editable seed categories on creation
 * (the provisioner ports stay ctor params typed as the port interfaces —
 * the composition root injects the drizzle implementations), and
 * re-reads the row when a concurrent create wins the identityKey race.
 */
export class DrizzleWorkspaceAdapter
  implements WorkspaceContextPort, WorkspaceSettingsPort
{
  constructor(
    private readonly db: DrizzleDb,
    private readonly catalog: WorkspaceCatalogProvisionerPort,
    private readonly seedCategories?: CategoryCatalogProvisionerPort,
  ) {}

  async resolve(caller: CallerIdentity): Promise<WorkspaceContext> {
    const identityKey = `${caller.issuer}|${caller.subject}`;
    const found = await this.findByIdentityKey(identityKey);
    const workspace = found ?? (await this.createWorkspace(identityKey));

    return {
      workspaceId: unwrap(WorkspaceId.create(workspace.id)),
      locale: workspace.locale,
      timezone: workspace.timezone,
      defaultCurrency: workspace.defaultCurrency,
    };
  }

  private async findByIdentityKey(
    identityKey: string,
  ): Promise<WorkspaceRow | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.identityKey, identityKey))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Creates the workspace and seeds its currency catalog with the default. */
  private async createWorkspace(identityKey: string): Promise<WorkspaceRow> {
    try {
      const rows = await this.db
        .insert(workspaces)
        .values({
          // Prisma generated the uuid client-side; the column has no
          // database default, so Drizzle must supply the id.
          id: randomUUID(),
          identityKey,
          kind: "personal",
          locale: "en-US",
          timezone: "UTC",
          defaultCurrency: "PEN",
        })
        .returning();
      const workspace = rows[0];
      if (!workspace) {
        throw new Error("workspace insert returned no row");
      }
      const workspaceId = unwrap(WorkspaceId.create(workspace.id));
      await this.catalog.ensureDefaultCurrency(
        workspaceId,
        workspace.defaultCurrency,
      );
      await this.seedCategories?.ensureSeedCategories(workspaceId);
      return workspace;
    } catch (error) {
      // A concurrent first request won the create (or a provisioner
      // failed after the row was written); re-read the row like the
      // prisma adapter does.
      const existing = await this.findByIdentityKey(identityKey);
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
    const set: {
      defaultCurrency?: string;
      locale?: string;
      timezone?: string;
    } = {};
    if (patch.defaultCurrency !== undefined) {
      set.defaultCurrency = patch.defaultCurrency;
    }
    if (patch.locale !== undefined) {
      set.locale = patch.locale;
    }
    if (patch.timezone !== undefined) {
      set.timezone = patch.timezone;
    }

    // Prisma `update` throws when the row is missing; an empty patch is
    // a plain re-read (prisma `update({ data: {} })` returns the row).
    const rows =
      Object.keys(set).length === 0
        ? await this.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId.value))
            .limit(1)
        : await this.db
            .update(workspaces)
            .set(set)
            .where(eq(workspaces.id, workspaceId.value))
            .returning();
    const workspace = rows[0];
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId.value}`);
    }
    return {
      workspaceId,
      locale: workspace.locale,
      timezone: workspace.timezone,
      defaultCurrency: workspace.defaultCurrency,
    };
  }
}
