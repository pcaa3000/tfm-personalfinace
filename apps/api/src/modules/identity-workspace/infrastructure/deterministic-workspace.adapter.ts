import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";

const LOCAL_IDENTITY_KEY = "local|dev-user";
const LOCAL_WORKSPACE_ID = "ws-local-dev";

/**
 * Deterministic adapter for local development (Corte 2): resolves a single
 * seeded workspace regardless of the caller. Replaced by the OIDC adapter
 * (Supabase Auth, issuer+subject) in Corte 4 without touching use cases.
 */
@Injectable()
export class DeterministicWorkspaceAdapter implements WorkspaceContextPort {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async resolve(_caller: CallerIdentity): Promise<WorkspaceContext> {
    const workspace = await this.prisma.workspace.upsert({
      where: { identityKey: LOCAL_IDENTITY_KEY },
      update: {},
      create: {
        id: LOCAL_WORKSPACE_ID,
        identityKey: LOCAL_IDENTITY_KEY,
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
