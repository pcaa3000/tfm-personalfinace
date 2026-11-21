import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApp, type HonoDeps } from "../app.js";
import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import { registerDemoRoutes } from "./demo.js";

/**
 * demo-maria-login T1 (S2/S4): POST /api/v1/demo/reset re-seeds the
 * `local|demo-maria` workspace. S4 fail-closed: createApp only mounts the
 * route when the composition root injects `demoReset`, which it does
 * exclusively under AUTH_MODE=dev — so an oidc/prod build has no route
 * to reach at all.
 */

const COUNTS = { income: 12, expense: 40, transfer: 3 };

const NO_LIMIT = { max: 0, windowMs: 60_000 } as const;

describe("POST /api/v1/demo/reset", () => {
  it("re-seeds the demo workspace and returns the seeded counts", async () => {
    const demoReset = { reset: vi.fn(async () => COUNTS) };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, { demoReset });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/reset", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seeded: true, counts: COUNTS });
    expect(demoReset.reset).toHaveBeenCalledTimes(1);
  });

  it("answers the generic 500 envelope when the seeder fails", async () => {
    const demoReset = {
      reset: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, { demoReset });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/reset", { method: "POST" });

    expect(res.status).toBe(500);
    expect((await res.json()) as { code: string }).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });

  it("is NOT mounted by createApp without the demoReset dep (S4 fail-closed)", async () => {
    const deps = {} as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/reset", { method: "POST" });

    expect(res.status).toBe(404);
  });

  it("is mounted by createApp when demoReset is provided (dev wiring)", async () => {
    const deps = {
      demoReset: { reset: vi.fn(async () => COUNTS) },
    } as unknown as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/reset", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seeded: true, counts: COUNTS });
  });
});
