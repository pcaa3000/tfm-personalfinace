import type { CallerIdentity } from "../../identity-workspace/index.js";

/** Result of materializing an ephemeral demo session workspace. */
export interface DemoSession {
  readonly sessionId: string;
  readonly workspaceId: string;
}

/**
 * demo-maria-session T1 (S2/S3/S8): each demo sign-in mints a session
 * id, creates an ephemeral `issuer|subject|sid` workspace of kind
 * `demo`, seeds it with the "María" dataset and wipes the subject's
 * previous demo workspaces — nothing persists across demo sessions.
 */
export interface DemoSessionPort {
  createSession(caller: CallerIdentity): Promise<DemoSession>;
}

export const DEMO_SESSION = Symbol("DEMO_SESSION");
