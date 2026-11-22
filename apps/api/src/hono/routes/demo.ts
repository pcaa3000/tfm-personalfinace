import type { Context, Hono } from "hono";

import type { DemoSeedCounts } from "../../drizzle/seed-demo-workspace.js";
import type { DemoSessionPort } from "../../modules/demo/index.js";
import type {
  CallerIdentity,
  CallerResolverPort,
} from "../../modules/identity-workspace/index.js";
import {
  DEMO_SESSION_HEADER,
  MAX_DEMO_SESSION_LENGTH,
  type HonoEnv,
} from "../middleware/auth.js";

/** Port the composition root fills with `seedDemoWorkspace` in dev mode. */
export interface DemoResetPort {
  reset(): Promise<DemoSeedCounts>;
}

/**
 * demo-maria-session T3 (S8): kicks the shared demo workspace
 * maintenance fire-and-forget. Implementations return immediately,
 * serialize concurrent runs (in-process mutex on top of the routine's
 * pg_advisory_xact_lock) and swallow+log failures — a broken refresh
 * must never surface on the request path.
 */
export interface DemoRefreshPort {
  trigger(caller: CallerIdentity): void;
}

export interface DemoRouteDeps {
  /**
   * demo-maria-login T1 (S4): present ONLY under AUTH_MODE=dev — the
   * composition root leaves it undefined otherwise and createApp then
   * never mounts the route (fail-closed, same policy as the x-dev-user
   * dev caller).
   */
  readonly demoReset?: DemoResetPort;
  /**
   * demo-maria-session T3 (S5/S8): shared-workspace refresher —
   * injected in EVERY auth mode so `POST /demo/refresh` exists in
   * qa/prod too, unlike the dev-only /demo/reset.
   */
  readonly demoRefresh?: DemoRefreshPort;
  /**
   * demo-maria-session T6 (S2–S5, S8; L10 final model): ephemeral
   * per-session demo workspace service — injected in EVERY auth mode
   * so `POST`/`DELETE /demo/session` exist in qa/prod too.
   */
  readonly demoSession?: DemoSessionPort;
  /**
   * DEMO_SUBJECT (S4): the only subject the demo endpoints serve.
   * Unset fails closed — the mounted routes still refuse everyone.
   */
  readonly demoSubject?: string;
  /** Normal caller resolution (JWT under oidc, x-dev-user under dev). */
  readonly callerResolver?: CallerResolverPort;
}

/**
 * Registers the demo routes. Each route mounts only when its dep is
 * injected (fail-closed):
 *
 * - `POST /api/v1/demo/reset` — wipes and re-seeds the
 *   `local|demo-maria` workspace so every demo login starts from the
 *   original synthetic dataset (S2). Dev-only by construction (S4): the
 *   dep exists only under AUTH_MODE=dev, and the route deliberately
 *   runs WITHOUT the auth middleware — the web calls it while
 *   establishing the demo session, before `x-dev-user: demo-maria`.
 *
 * - `POST /api/v1/demo/refresh` (demo-maria-session T3, S5/S8): mounted
 *   in ALL auth modes. Resolves the caller through the normal auth
 *   pipeline (real JWT under oidc, x-dev-user under dev) but does NOT
 *   resolve a workspace — the maintenance routine owns the shared
 *   `issuer|subject` workspace bootstrap itself. Only DEMO_SUBJECT may
 *   trigger it; anyone else gets a 403 that never reveals whether the
 *   endpoint is wired. On success it answers 202 `{refresh:'started'}`
 *   immediately and the restore runs in the background — S6: the
 *   routine wipes the workspace's session changes and re-seeds the
 *   rolling 3-month dataset.
 *
 * - `POST /api/v1/demo/session` (demo-maria-session T6, S4/S8; L10):
 *   mounted in ALL auth modes. Same caller resolution + DEMO_SUBJECT
 *   gate as /demo/refresh, no workspace resolution — the demo subject
 *   has none until the session is minted. Answers 201
 *   `{sessionId, workspaceId}` immediately: the kind='demo' workspace
 *   row already exists so the fail-closed resolver accepts the sid
 *   while the dataset (months current/-1/-2) seeds fire-and-forget in
 *   the background and the >24h orphan sweep runs after it.
 *
 * - `DELETE /api/v1/demo/session` (demo-maria-session T6; L10): same
 *   subject gate; reads the `x-demo-session` header, deletes THAT
 *   session's workspace with its data and runs the >24h orphan sweep.
 *   Always 204 — an unknown or missing sid is a no-op logout.
 */
export function registerDemoRoutes(
  app: Hono<HonoEnv>,
  deps: DemoRouteDeps,
): void {
  if (deps.demoReset) {
    const demoReset = deps.demoReset;
    app.post("/api/v1/demo/reset", async (c) => {
      const counts = await demoReset.reset();
      return c.json({ seeded: true, counts });
    });
  }

  if (deps.demoRefresh) {
    const demoRefresh = deps.demoRefresh;
    app.post("/api/v1/demo/refresh", async (c) => {
      const headers: Record<string, string | undefined> = {};
      c.req.raw.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const caller = deps.callerResolver
        ? await deps.callerResolver.resolve(headers)
        : null;
      if (!caller) {
        return c.json(
          { code: "UNAUTHENTICATED", message: "Authentication required" },
          401,
        );
      }
      if (
        deps.demoSubject === undefined ||
        caller.subject !== deps.demoSubject
      ) {
        return c.json(
          {
            code: "DEMO_FORBIDDEN",
            message: "Demo refresh endpoint is restricted",
          },
          403,
        );
      }
      demoRefresh.trigger(caller);
      return c.json({ refresh: "started" }, 202);
    });
  }

  if (deps.demoSession) {
    const demoSession = deps.demoSession;
    /**
     * Shared gate for POST + DELETE /demo/session (S4): resolve the
     * caller through the normal auth pipeline and serve only
     * DEMO_SUBJECT — the 403 never reveals whether the endpoint is
     * wired, and an unset demoSubject fails closed.
     */
    const gate = async (
      c: Context<HonoEnv>,
    ): Promise<
      | { readonly ok: true; readonly caller: CallerIdentity }
      | { readonly ok: false; readonly response: Response }
    > => {
      const headers: Record<string, string | undefined> = {};
      c.req.raw.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const caller = deps.callerResolver
        ? await deps.callerResolver.resolve(headers)
        : null;
      if (!caller) {
        return {
          ok: false,
          response: c.json(
            { code: "UNAUTHENTICATED", message: "Authentication required" },
            401,
          ),
        };
      }
      if (
        deps.demoSubject === undefined ||
        caller.subject !== deps.demoSubject
      ) {
        return {
          ok: false,
          response: c.json(
            {
              code: "DEMO_FORBIDDEN",
              message: "Demo session endpoint is restricted",
            },
            403,
          ),
        };
      }
      return { ok: true, caller };
    };

    app.post("/api/v1/demo/session", async (c) => {
      const gated = await gate(c);
      if (!gated.ok) return gated.response;
      const session = await demoSession.createSession(gated.caller);
      return c.json(
        {
          sessionId: session.sessionId,
          workspaceId: session.workspaceId,
        },
        201,
      );
    });

    app.get("/api/v1/demo/session/status", async (c) => {
      const gated = await gate(c);
      if (!gated.ok) return gated.response;
      const sessionId =
        c.req
          .header(DEMO_SESSION_HEADER)
          ?.trim()
          .slice(0, MAX_DEMO_SESSION_LENGTH) ?? "";
      const status = await demoSession.sessionStatus(gated.caller, sessionId);
      return c.json({ ready: status.ready });
    });

    app.delete("/api/v1/demo/session", async (c) => {
      const gated = await gate(c);
      if (!gated.ok) return gated.response;
      const sessionId =
        c.req
          .header(DEMO_SESSION_HEADER)
          ?.trim()
          .slice(0, MAX_DEMO_SESSION_LENGTH) ?? "";
      await demoSession.endSession(gated.caller, sessionId);
      return c.body(null, 204);
    });
  }
}
