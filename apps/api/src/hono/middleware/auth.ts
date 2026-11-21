import type { Context, MiddlewareHandler } from "hono";

import type {
  CallerIdentity,
  CallerResolverPort,
  WorkspaceContext,
  WorkspaceContextPort,
} from "../../modules/identity-workspace/index.js";

/** Variables stored on the Hono context by the auth middleware. */
export interface HonoVariables {
  caller: CallerIdentity;
  workspace: WorkspaceContext;
}

export interface HonoEnv {
  Variables: HonoVariables;
}

export interface AuthDeps {
  readonly callerResolver: CallerResolverPort;
  readonly workspaceContext: WorkspaceContextPort;
}

/** demo-maria-session T1 (S5): carries the ephemeral demo session id. */
export const DEMO_SESSION_HEADER = "x-demo-session";

const MAX_DEMO_SESSION_LENGTH = 128;

/** Collects the request headers into the resolver's plain-record shape. */
function collectHeaders(c: Context<HonoEnv>): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/**
 * Resolves the caller once per request and stores caller + workspace on the
 * context, so route handlers stop repeating the per-endpoint boilerplate the
 * Nest controllers have. Unauthenticated requests get the generic 401 that
 * never reveals whether an account exists.
 *
 * demo-maria-session T1 (S5): the `x-demo-session` header is attached to
 * the caller identity as an optional component — only the demo subject's
 * workspace resolver consumes it; for everyone else it is inert.
 */
export function authMiddleware(deps: AuthDeps): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const headers = collectHeaders(c);
    const caller = await deps.callerResolver.resolve(headers);
    if (!caller) {
      return c.json(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        401,
      );
    }
    const rawSid = headers[DEMO_SESSION_HEADER];
    const demoSessionId =
      (Array.isArray(rawSid) ? rawSid[0] : rawSid)
        ?.trim()
        .slice(0, MAX_DEMO_SESSION_LENGTH) || undefined;
    const callerWithSession: CallerIdentity = demoSessionId
      ? { ...caller, demoSessionId }
      : caller;
    const workspace = await deps.workspaceContext.resolve(callerWithSession);
    c.set("caller", callerWithSession);
    c.set("workspace", workspace);
    await next();
  };
}

/** Reads the caller/workspace stored by {@link authMiddleware}. */
export function authContext(c: Context<HonoEnv>): {
  caller: CallerIdentity;
  workspace: WorkspaceContext;
} {
  return { caller: c.get("caller"), workspace: c.get("workspace") };
}
