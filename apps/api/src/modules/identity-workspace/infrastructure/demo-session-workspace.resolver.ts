import { and, eq } from "drizzle-orm";

import type { DrizzleDb } from "../../../drizzle/db.js";
import { workspaces } from "../../../drizzle/schema.js";
import { WorkspaceId, type Result, type DomainError } from "../../shared-kernel/index.js";
import { DemoSessionError } from "../application/demo-session.error.js";
import type {
  CallerIdentity,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../application/workspace-context.port.js";

function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/**
 * demo-maria-session T6 (S5, restored per L10 decision B): wraps the
 * lazy-create workspace resolver with fail-closed demo-session
 * resolution. Non-demo callers delegate verbatim. For the configured
 * DEMO_SUBJECT the workspace is resolved from the `x-demo-session`
 * sid: `issuer|subject|sid` must already exist as a kind='demo'
 * workspace (created by POST /demo/session). A missing or invalid sid
 * throws {@link DemoSessionError} → 403 — the shared `issuer|subject`
 * workspace is never resolved nor lazily created for the demo
 * subject.
 */
export class DemoSessionWorkspaceResolver implements WorkspaceContextPort {
  constructor(
    private readonly db: DrizzleDb,
    private readonly inner: WorkspaceContextPort,
    private readonly demoSubject?: string,
  ) {}

  async resolve(caller: CallerIdentity): Promise<WorkspaceContext> {
    if (
      this.demoSubject === undefined ||
      caller.subject !== this.demoSubject
    ) {
      return this.inner.resolve(caller);
    }

    const sid = caller.demoSessionId;
    if (!sid) {
      throw new DemoSessionError(
        "DEMO_SESSION_REQUIRED",
        "A valid x-demo-session header is required",
      );
    }

    const identityKey = `${caller.issuer}|${caller.subject}|${sid}`;
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.identityKey, identityKey),
          eq(workspaces.kind, "demo"),
        ),
      )
      .limit(1);
    if (!row) {
      throw new DemoSessionError(
        "DEMO_SESSION_INVALID",
        "Invalid or expired demo session",
      );
    }

    return {
      workspaceId: unwrap(WorkspaceId.create(row.id)),
      timezone: row.timezone,
      defaultCurrency: row.defaultCurrency,
    };
  }
}
