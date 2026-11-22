import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApp, type HonoDeps } from "../app.js";
import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import type { CallerIdentity } from "../../modules/identity-workspace/index.js";
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

/**
 * demo-maria-session T3 (S5/S8): POST /api/v1/demo/refresh is mounted in
 * EVERY auth mode whenever the composition root injects `demoRefresh`
 * (unlike /demo/reset, which stays dev-only). It reuses the normal
 * caller resolution — a real JWT under oidc, x-dev-user under dev —
 * serves only the configured DEMO_SUBJECT, and returns 202 immediately:
 * the workspace restore (S6: wipe + re-seed of the seed state, so a
 * session's changes are discarded on the next demo sign-in) runs
 * fire-and-forget in the background.
 */
describe("POST /api/v1/demo/refresh (demo-maria-session T3, S5/S8)", () => {
  const DEMO_CALLER: CallerIdentity = {
    issuer: "https://issuer.example/auth/v1",
    subject: "demo-subject-uuid",
  };

  function buildRefreshApp(options: {
    readonly caller?: CallerIdentity | null;
    readonly demoSubject?: string;
  } = {}) {
    const caller = options.caller === undefined ? DEMO_CALLER : options.caller;
    const callerResolver = { resolve: vi.fn(async () => caller) };
    const demoRefresh = { trigger: vi.fn() };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoRefresh,
      callerResolver,
      demoSubject: options.demoSubject ?? DEMO_CALLER.subject,
    });
    app.onError(httpErrorHandler());
    return { app, callerResolver, demoRefresh };
  }

  it("answers 401 when caller resolution yields no identity", async () => {
    const { app, demoRefresh } = buildRefreshApp({ caller: null });

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(401);
    expect((await res.json()) as { code: string }).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(demoRefresh.trigger).not.toHaveBeenCalled();
  });

  it("answers 403 when the caller subject is not DEMO_SUBJECT", async () => {
    const { app, demoRefresh } = buildRefreshApp({
      caller: { issuer: "local", subject: "dev-user" },
    });

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_FORBIDDEN",
      message: "Demo refresh endpoint is restricted",
    });
    expect(demoRefresh.trigger).not.toHaveBeenCalled();
  });

  it("answers 403 when DEMO_SUBJECT is not configured (fail closed)", async () => {
    const demoRefresh = { trigger: vi.fn() };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoRefresh,
      callerResolver: { resolve: vi.fn(async () => DEMO_CALLER) },
      // demoSubject deliberately absent
    });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_FORBIDDEN",
      message: "Demo refresh endpoint is restricted",
    });
    expect(demoRefresh.trigger).not.toHaveBeenCalled();
  });

  it("answers 202 {refresh:'started'} immediately and kicks the async refresh (S8)", async () => {
    const { app, callerResolver, demoRefresh } = buildRefreshApp();

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ refresh: "started" });
    expect(callerResolver.resolve).toHaveBeenCalledTimes(1);
    // The route fires the background maintenance and never awaits it.
    expect(demoRefresh.trigger).toHaveBeenCalledWith({
      issuer: DEMO_CALLER.issuer,
      subject: DEMO_CALLER.subject,
    });
  });

  it("is mounted by createApp whenever demoRefresh is injected (all auth modes)", async () => {
    const deps = {
      callerResolver: { resolve: vi.fn(async () => DEMO_CALLER) },
      demoRefresh: { trigger: vi.fn() },
      demoSubject: DEMO_CALLER.subject,
    } as unknown as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ refresh: "started" });
  });

  it("is NOT mounted by createApp without the demoRefresh dep (fail-closed)", async () => {
    const deps = {} as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/refresh", { method: "POST" });

    expect(res.status).toBe(404);
  });
});
