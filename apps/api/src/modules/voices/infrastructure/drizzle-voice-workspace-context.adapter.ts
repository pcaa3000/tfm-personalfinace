import { eq } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { workspaces } from "../../../drizzle/schema.js";
import type { WorkspaceId } from "../../shared-kernel/index.js";
import type {
  VoiceWorkspaceContext,
  VoiceWorkspaceContextPort,
} from "../application/ports/voice-workspace-context.port.js";

/**
 * Drizzle read of the workspace preferences the voice-draft pipeline
 * needs (voice-drafts T2, S3): timezone (business-date resolution) and
 * defaultCurrency (currency fallback). Read-only — the background job
 * has no caller identity, so it looks the row up by workspace id
 * instead of resolving through `WorkspaceContextPort`.
 */
export class DrizzleVoiceWorkspaceContextAdapter
  implements VoiceWorkspaceContextPort
{
  constructor(private readonly db: DrizzleDb) {}

  async findContext(
    workspaceId: WorkspaceId,
  ): Promise<VoiceWorkspaceContext | null> {
    const rows = await this.db
      .select({
        timezone: workspaces.timezone,
        defaultCurrency: workspaces.defaultCurrency,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId.value))
      .limit(1);
    const row = rows[0];
    return row
      ? { timezone: row.timezone, defaultCurrency: row.defaultCurrency }
      : null;
  }
}
