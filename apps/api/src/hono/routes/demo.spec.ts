import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApp, type HonoDeps } from "../app.js";
import { httpErrorHandler } from "../middleware/errors.js";
import {
  authContext,
  authMiddleware,
  type HonoEnv,
} from "../middleware/auth.js";
import {
  DevHeaderCallerResolver,
  DemoSessionError,
  type CallerIdentity,
  type WorkspaceContext,
} from "../../modules/identity-workspace/index.js";
import { WorkspaceId } from "../../modules/shared-kernel/index.js";
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

/**
 * demo-maria-session T6 (S4/S8, L10 final model): POST
 * /api/v1/demo/session is mounted in EVERY auth mode whenever the
 * composition root injects `demoSession` (unlike /demo/reset, which
 * stays dev-only). It reuses the normal caller resolution — a real JWT
 * under oidc, x-dev-user under dev — and serves only the configured
 * DEMO_SUBJECT; everyone else gets a 403 that never reveals whether
 * the endpoint is wired. The response is immediate (201 with the new
 * {sessionId, workspaceId}): the workspace row is already created so
 * the fail-closed resolver accepts the sid while the dataset seeds in
 * the background.
 */
describe("POST /api/v1/demo/session (demo-maria-session T6, S4/S8)", () => {
  const DEMO_CALLER: CallerIdentity = {
    issuer: "https://issuer.example/auth/v1",
    subject: "demo-subject-uuid",
  };

  function buildSessionApp(options: {
    readonly caller?: CallerIdentity | null;
    readonly demoSubject?: string;
    readonly sessionId?: string;
  } = {}) {
    const caller = options.caller === undefined ? DEMO_CALLER : options.caller;
    const callerResolver = { resolve: vi.fn(async () => caller) };
    const demoSession = {
      createSession: vi.fn(async (_caller: CallerIdentity) => ({
        sessionId: options.sessionId ?? "sid-fixed",
        workspaceId: `ws-demo-${options.sessionId ?? "sid-fixed"}`,
      })),
      endSession: vi.fn(async () => undefined),
      sessionStatus: vi.fn(async () => ({ ready: false })),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver,
      demoSubject: options.demoSubject ?? DEMO_CALLER.subject,
    });
    app.onError(httpErrorHandler());
    return { app, callerResolver, demoSession };
  }

  it("answers 401 when caller resolution yields no identity", async () => {
    const { app, demoSession } = buildSessionApp({ caller: null });

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(401);
    expect((await res.json()) as { code: string }).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
    expect(demoSession.createSession).not.toHaveBeenCalled();
  });

  it("answers 403 when the caller subject is not DEMO_SUBJECT", async () => {
    const { app, demoSession } = buildSessionApp({
      caller: { issuer: "local", subject: "dev-user" },
    });

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_FORBIDDEN",
      message: "Demo session endpoint is restricted",
    });
    expect(demoSession.createSession).not.toHaveBeenCalled();
  });

  it("answers 403 when DEMO_SUBJECT is not configured (fail closed)", async () => {
    const demoSession = {
      createSession: vi.fn(),
      endSession: vi.fn(),
      sessionStatus: vi.fn(),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver: { resolve: vi.fn(async () => DEMO_CALLER) },
      // demoSubject deliberately absent
    });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_FORBIDDEN",
      message: "Demo session endpoint is restricted",
    });
    expect(demoSession.createSession).not.toHaveBeenCalled();
  });

  it("creates the session for DEMO_SUBJECT and returns 201 {sessionId, workspaceId} immediately", async () => {
    const { app, callerResolver, demoSession } = buildSessionApp({
      sessionId: "sid-abc",
    });

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      sessionId: "sid-abc",
      workspaceId: "ws-demo-sid-abc",
    });
    expect(callerResolver.resolve).toHaveBeenCalledTimes(1);
    expect(demoSession.createSession).toHaveBeenCalledWith({
      issuer: DEMO_CALLER.issuer,
      subject: DEMO_CALLER.subject,
    });
  });

  it("is mounted by createApp whenever demoSession is injected (all auth modes)", async () => {
    const deps = {
      callerResolver: { resolve: vi.fn(async () => DEMO_CALLER) },
      demoSession: {
        createSession: vi.fn(async () => ({
          sessionId: "sid-mount",
          workspaceId: "ws-demo-sid-mount",
        })),
        endSession: vi.fn(async () => undefined),
      },
      demoSubject: DEMO_CALLER.subject,
    } as unknown as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      sessionId: "sid-mount",
      workspaceId: "ws-demo-sid-mount",
    });
  });

  it("is NOT mounted by createApp without the demoSession dep (fail-closed)", async () => {
    const deps = {} as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/session", { method: "POST" });

    expect(res.status).toBe(404);
  });
});

/**
 * demo-maria-session T6 (S3/S5, L10): DELETE /api/v1/demo/session ends
 * the browser's demo session — the workspace named by the
 * `x-demo-session` header is deleted with its data and the >24h orphan
 * sweep runs as part of the same logout. Idempotent: unknown or
 * missing sids still answer 204.
 */
describe("DELETE /api/v1/demo/session (demo-maria-session T6)", () => {
  const DEMO_CALLER: CallerIdentity = {
    issuer: "local",
    subject: "demo-maria",
  };

  function buildDeleteApp(options: {
    readonly caller?: CallerIdentity | null;
    readonly demoSubject?: string;
  } = {}) {
    const caller = options.caller === undefined ? DEMO_CALLER : options.caller;
    const callerResolver = { resolve: vi.fn(async () => caller) };
    const demoSession = {
      createSession: vi.fn(),
      endSession: vi.fn(async () => undefined),
      sessionStatus: vi.fn(async () => ({ ready: false })),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver,
      demoSubject: options.demoSubject ?? DEMO_CALLER.subject,
    });
    app.onError(httpErrorHandler());
    return { app, demoSession };
  }

  it("answers 401 when caller resolution yields no identity", async () => {
    const { app, demoSession } = buildDeleteApp({ caller: null });

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
      headers: { "x-demo-session": "sid-1" },
    });

    expect(res.status).toBe(401);
    expect(demoSession.endSession).not.toHaveBeenCalled();
  });

  it("answers 403 when the caller subject is not DEMO_SUBJECT", async () => {
    const { app, demoSession } = buildDeleteApp({
      caller: { issuer: "local", subject: "dev-user" },
    });

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
      headers: { "x-demo-session": "sid-1" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_FORBIDDEN",
      message: "Demo session endpoint is restricted",
    });
    expect(demoSession.endSession).not.toHaveBeenCalled();
  });

  it("answers 403 when DEMO_SUBJECT is not configured (fail closed)", async () => {
    const demoSession = {
      createSession: vi.fn(),
      endSession: vi.fn(),
      sessionStatus: vi.fn(),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver: { resolve: vi.fn(async () => DEMO_CALLER) },
      // demoSubject deliberately absent
    });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
      headers: { "x-demo-session": "sid-1" },
    });

    expect(res.status).toBe(403);
    expect(demoSession.endSession).not.toHaveBeenCalled();
  });

  it("answers 204 and ends the session named by x-demo-session", async () => {
    const { app, demoSession } = buildDeleteApp();

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
      headers: { "x-demo-session": "  sid-live  " },
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(demoSession.endSession).toHaveBeenCalledWith(
      { issuer: "local", subject: "demo-maria" },
      "sid-live",
    );
  });

  it("answers 204 for an unknown sid (idempotent logout)", async () => {
    const { app, demoSession } = buildDeleteApp();

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
      headers: { "x-demo-session": "sid-unknown" },
    });

    expect(res.status).toBe(204);
    expect(demoSession.endSession).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "demo-maria" }),
      "sid-unknown",
    );
  });

  it("answers 204 without an x-demo-session header — the orphan sweep still runs", async () => {
    const { app, demoSession } = buildDeleteApp();

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(demoSession.endSession).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "demo-maria" }),
      "",
    );
  });

  it("is NOT mounted by createApp without the demoSession dep (fail-closed)", async () => {
    const deps = {} as HonoDeps;
    const app = createApp(deps, {
      rateLimit: NO_LIMIT,
      rateLimitRead: NO_LIMIT,
    });

    const res = await app.request("/api/v1/demo/session", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });
});

/**
 * demo-maria-session T6 (S5): the auth middleware forwards the
 * `x-demo-session` header into the caller identity so the workspace
 * resolver can pick the ephemeral `issuer|subject|sid` workspace, and
 * a demo-session resolution failure maps to a fail-closed 403 — never
 * the shared `issuer|subject` workspace.
 */
describe("GET /api/v1/demo/session/status (demo-maria-session T9, S10)", () => {
  const DEMO_CALLER: CallerIdentity = {
    issuer: "local",
    subject: "demo-maria",
  };

  it("answers {ready} for the x-demo-session sid", async () => {
    const callerResolver = { resolve: vi.fn(async () => DEMO_CALLER) };
    const demoSession = {
      createSession: vi.fn(),
      endSession: vi.fn(),
      sessionStatus: vi.fn(async () => ({ ready: true })),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver,
      demoSubject: DEMO_CALLER.subject,
    });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/session/status", {
      headers: { "x-demo-session": "sid-live" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true });
    expect(demoSession.sessionStatus).toHaveBeenCalledWith(
      DEMO_CALLER,
      "sid-live",
    );
  });

  it("applies the same subject gate as POST/DELETE (403 for non-demo subjects)", async () => {
    const callerResolver = {
      resolve: vi.fn(async () => ({ issuer: "local", subject: "dev-user" })),
    };
    const demoSession = {
      createSession: vi.fn(),
      endSession: vi.fn(),
      sessionStatus: vi.fn(),
    };
    const app = new Hono<HonoEnv>();
    registerDemoRoutes(app, {
      demoSession,
      callerResolver,
      demoSubject: DEMO_CALLER.subject,
    });
    app.onError(httpErrorHandler());

    const res = await app.request("/api/v1/demo/session/status", {
      headers: { "x-demo-session": "sid-1" },
    });

    expect(res.status).toBe(403);
    expect(demoSession.sessionStatus).not.toHaveBeenCalled();
  });
});

describe("x-demo-session plumbing (demo-maria-session T6, S5)", () => {
  const WS_CTX: WorkspaceContext = {
    workspaceId: (() => {
      const id = WorkspaceId.create("ws-probe");
      if (!id.ok) throw id.error;
      return id.value;
    })(),
    timezone: "UTC",
    defaultCurrency: "PEN",
  };

  function probeApp(workspaceContext: {
    resolve: (caller: CallerIdentity) => Promise<WorkspaceContext>;
  }) {
    const app = new Hono<HonoEnv>();
    app.get(
      "/probe",
      authMiddleware({
        callerResolver: new DevHeaderCallerResolver(),
        workspaceContext,
      }),
      (c) => c.json(authContext(c).caller),
    );
    app.onError(httpErrorHandler());
    return app;
  }

  it("attaches the x-demo-session header to the caller before workspace resolution", async () => {
    const captured: CallerIdentity[] = [];
    const app = probeApp({
      resolve: async (caller) => {
        captured.push(caller);
        return WS_CTX;
      },
    });

    const res = await app.request("/probe", {
      headers: { "x-dev-user": "demo-maria", "x-demo-session": "sid-123" },
    });

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      issuer: "local",
      subject: "demo-maria",
      demoSessionId: "sid-123",
    });
  });

  it("leaves the caller untouched when the header is absent", async () => {
    const captured: CallerIdentity[] = [];
    const app = probeApp({
      resolve: async (caller) => {
        captured.push(caller);
        return WS_CTX;
      },
    });

    const res = await app.request("/probe", {
      headers: { "x-dev-user": "dev-user" },
    });

    expect(res.status).toBe(200);
    expect(captured[0]).toEqual({ issuer: "local", subject: "dev-user" });
  });

  it("maps a demo-session resolution failure to a fail-closed 403", async () => {
    const app = probeApp({
      resolve: async () => {
        throw new DemoSessionError(
          "DEMO_SESSION_REQUIRED",
          "A valid x-demo-session header is required",
        );
      },
    });

    const res = await app.request("/probe", {
      headers: { "x-dev-user": "demo-maria" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual({
      code: "DEMO_SESSION_REQUIRED",
      message: "A valid x-demo-session header is required",
    });
  });
});
