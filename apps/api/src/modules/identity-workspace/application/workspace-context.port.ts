import type { WorkspaceId } from "../../shared-kernel/index.js";

/** Caller identity normalized from an auth token (issuer + subject). */
export interface CallerIdentity {
  readonly issuer: string;
  readonly subject: string;
}

/** Server-resolved financial context; never taken from client input. */
export interface WorkspaceContext {
  readonly workspaceId: WorkspaceId;
  readonly locale: string;
  readonly timezone: string;
  readonly defaultCurrency: string;
}

export interface WorkspaceContextPort {
  resolve(caller: CallerIdentity): Promise<WorkspaceContext>;
}

export const WORKSPACE_CONTEXT = Symbol("WORKSPACE_CONTEXT");
