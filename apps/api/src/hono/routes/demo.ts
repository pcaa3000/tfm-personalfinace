import type { Hono } from "hono";

import type { DemoSeedCounts } from "../../drizzle/seed-demo-workspace.js";
import type {
  CallerIdentity,
  CallerResolverPort,
} from "../../modules/identity-workspace/index.js";
import type { HonoEnv } from "../middleware/auth.js";

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
   * DEMO_SUBJECT (S4): the only subject the refresh endpoint serves.
   * Unset fails closed — the mounted route still refuses everyone.
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
 *   immediately and the maintenance runs in the background.
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
}
