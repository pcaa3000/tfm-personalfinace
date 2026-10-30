import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";

/**
 * Deterministic adapter for local development: resolves (and lazily creates)
 * one workspace per caller identity key "issuer|subject". The caller arrives
 * through the x-dev-user header until the OIDC adapter (Supabase Auth) lands
 * in Corte 4 — the port contract and use cases do not change.
 */
@Injectable()
export class DeterministicWorkspaceAdapter implements WorkspaceContextPort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async resolve(caller: CallerIdentity): Promise<WorkspaceContext> {
    const identityKey = `${caller.issuer}|${caller.subject}`;
    const workspace = await this.prisma.workspace.upsert({
      where: { identityKey },
      update: {},
      create: {
        identityKey,
        kind: "personal",
        locale: "en-US",
        timezone: "UTC",
        defaultCurrency: "USD",
      },
    });

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
}
