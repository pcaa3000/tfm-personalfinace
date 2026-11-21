import type { WorkspaceId } from "../../shared-kernel/index.js";

/** Caller identity normalized from an auth token (issuer + subject). */
export interface CallerIdentity {
  readonly issuer: string;
  readonly subject: string;
  /**
   * demo-maria-session T1 (S5): optional ephemeral demo session id,
   * forwarded from the `x-demo-session` request header by the auth
   * middleware. Only the configured demo subject's workspace resolver
   * consumes it; every other caller ignores it.
   */
  readonly demoSessionId?: string;
}

/** Server-resolved financial context; never taken from client input. */
export interface WorkspaceContext {
  readonly workspaceId: WorkspaceId;
  readonly timezone: string;
  readonly defaultCurrency: string;
}

export interface WorkspaceContextPort {
  resolve(caller: CallerIdentity): Promise<WorkspaceContext>;
}

export const WORKSPACE_CONTEXT = Symbol("WORKSPACE_CONTEXT");
