import type { CallerIdentity } from "../../identity-workspace/index.js";

/** Result of materializing an ephemeral demo session workspace. */
export interface DemoSession {
  readonly sessionId: string;
  readonly workspaceId: string;
}

/**
 * demo-maria-session T6 (S2/S3/S5/S8; L10 final model): each demo
 * sign-in mints a session id, creates an ephemeral
 * `issuer|subject|sid` workspace of kind `demo` and kicks the María
 * dataset seed asynchronously — the workspace row exists before the
 * port resolves so the fail-closed resolver accepts the new sid while
 * the data is still being generated. Ending a session deletes that
 * session's workspace with its data and runs the >24h orphan sweep
 * (idempotent: an unknown sid still sweeps and resolves).
 */
export interface DemoSessionPort {
  createSession(caller: CallerIdentity): Promise<DemoSession>;
  endSession(caller: CallerIdentity, sessionId: string): Promise<void>;
}

export const DEMO_SESSION = Symbol("DEMO_SESSION");
