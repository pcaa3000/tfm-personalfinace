import type { Hono } from "hono";

import type { DemoSeedCounts } from "../../drizzle/seed-demo-workspace.js";
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
}

/**
 * Registers `POST /api/v1/demo/reset` — wipes and re-seeds the
 * `local|demo-maria` workspace so every demo login starts from the
 * original synthetic dataset (S2). Dev-only by construction (S4): the
 * route exists only when the dep is injected, and it deliberately runs
 * WITHOUT the auth middleware — the web calls it while establishing the
 * demo session, before `x-dev-user: demo-maria` is set.
 */
export function registerDemoRoutes(
  app: Hono<HonoEnv>,
  deps: { readonly demoReset: DemoResetPort },
): void {
  app.post("/api/v1/demo/reset", async (c) => {
    const counts = await deps.demoReset.reset();
    return c.json({ seeded: true, counts });
  });
}
