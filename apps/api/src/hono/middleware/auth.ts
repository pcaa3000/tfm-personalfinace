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

/**
 * Resolves the caller once per request and stores caller + workspace on the
 * context, so route handlers stop repeating the per-endpoint boilerplate the
 * Nest controllers have. Unauthenticated requests get the generic 401 that
 * never reveals whether an account exists.
 */
export function authMiddleware(deps: AuthDeps): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const headers: Record<string, string | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const caller = await deps.callerResolver.resolve(headers);
    if (!caller) {
      return c.json(
        { code: "UNAUTHENTICATED", message: "Authentication required" },
        401,
      );
    }
    const workspace = await deps.workspaceContext.resolve(caller);
    c.set("caller", caller);
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
