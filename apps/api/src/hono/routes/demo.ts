import type { Hono } from "hono";

import type { DemoSeedCounts } from "../../drizzle/seed-demo-workspace.js";
import type { DemoSessionPort } from "../../modules/demo/index.js";
import type { CallerResolverPort } from "../../modules/identity-workspace/index.js";
import type { HonoEnv } from "../middleware/auth.js";

/** Port the composition root fills with `seedDemoWorkspace` in dev mode. */
export interface DemoResetPort {
  reset(): Promise<DemoSeedCounts>;
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
   * demo-maria-session T1 (S2–S4): ephemeral per-session demo workspace
   * materializer — injected in EVERY auth mode so `POST /demo/session`
   * exists in qa/prod too, unlike the dev-only /demo/reset.
   */
  readonly demoSession?: DemoSessionPort;
  /**
   * DEMO_SUBJECT (S4): the only subject the session endpoint serves.
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
 * - `POST /api/v1/demo/session` (demo-maria-session T1, S2–S4): mounted
 *   in ALL auth modes. Resolves the caller through the normal auth
 *   pipeline (real JWT under oidc, x-dev-user under dev) but does NOT
 *   resolve a workspace — the demo subject has none yet. Only
 *   DEMO_SUBJECT may create a session; anyone else gets a 403 that
 *   never reveals whether the endpoint is wired.
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

  if (deps.demoSession) {
    const demoSession = deps.demoSession;
    app.post("/api/v1/demo/session", async (c) => {
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
            message: "Demo session endpoint is restricted",
          },
          403,
        );
      }
      const session = await demoSession.createSession(caller);
      return c.json({ sessionId: session.sessionId });
    });
  }
}
