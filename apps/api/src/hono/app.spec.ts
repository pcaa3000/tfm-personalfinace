import { describe, expect, it, vi } from "vitest";

import type {
  CallerIdentity,
  WorkspaceContext,
} from "../modules/identity-workspace/index.js";
import type { AccountView } from "../modules/accounts/application/account.view.js";
import type { CategoryView } from "../modules/categorization/index.js";
import type { CurrencyView } from "../modules/currencies/index.js";
import { WorkspaceId, ok } from "../modules/shared-kernel/index.js";
import { createApp } from "./app.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const CALLER: CallerIdentity = { issuer: "test", subject: "user-1" };
const WORKSPACE: WorkspaceContext = {
  workspaceId: WS,
  locale: "en",
  timezone: "UTC",
  defaultCurrency: "EUR",
};

function accountView(overrides: Partial<AccountView> = {}): AccountView {
  return {
    id: "acc-1",
    workspaceId: "ws-1",
    name: "Checking",
    currency: "EUR",
    kind: "bank",
    initialBalance: "0.00",
    archivedAt: null,
    ...overrides,
  };
}

function categoryView(overrides: Partial<CategoryView> = {}): CategoryView {
  return {
    id: "cat-1",
    key: "e2e_mascotas",
    label: "Mascotas",
    nature: "discretionary",
    custom: true,
    ...overrides,
  };
}

function currencyView(overrides: Partial<CurrencyView> = {}): CurrencyView {
  return {
    id: "cur-1",
    workspaceId: "ws-1",
    code: "EUR",
    nameEn: "Euro",
    nameEs: "Euro",
    minorUnitExponent: 2,
    archivedAt: null,
    ...overrides,
  };
}

function makeDeps() {
  return {
    callerResolver: {
      resolve: vi.fn(async () => CALLER),
    },
    workspaceContext: {
      resolve: vi.fn(async () => WORKSPACE),
    },
    recordManual: { execute: vi.fn(async () => ok(accountView() as never)) },
    listTransactions: { execute: vi.fn(async () => []) },
    reviseTransaction: { execute: vi.fn(async () => ok(accountView() as never)) },
    voidTransaction: { execute: vi.fn(async () => ok(accountView() as never)) },
    listRevisions: { execute: vi.fn(async () => ok([])) },
    createAccount: { execute: vi.fn(async () => ok(accountView())) },
    listAccounts: { execute: vi.fn(async () => [accountView()]) },
    reviseAccount: { execute: vi.fn(async () => ok(accountView())) },
    archiveAccount: {
      execute: vi.fn(async () =>
        ok(accountView({ archivedAt: "2026-10-28T00:00:00.000Z" })),
      ),
    },
    categoryCatalog: {
      listForWorkspace: vi.fn(async () => [categoryView()]),
    },
    createCategory: { execute: vi.fn(async () => ok(categoryView())) },
    reviseCategory: { execute: vi.fn(async () => ok(categoryView())) },
    archiveCategory: { execute: vi.fn(async () => ok(categoryView())) },
    listCurrencies: { execute: vi.fn(async () => [currencyView()]) },
    listIsoCatalog: {
      execute: vi.fn(() => [
        {
          code: "USD",
          nameEn: "US Dollar",
          nameEs: "Dólar estadounidense",
          minorUnitExponent: 2,
        },
      ]),
    },
    addCurrency: { execute: vi.fn(async () => ok(currencyView())) },
    reviseCurrency: { execute: vi.fn(async () => ok(currencyView())) },
    archiveCurrency: { execute: vi.fn(async () => ok(currencyView())) },
    updatePreferences: { execute: vi.fn(async () => ok(WORKSPACE)) },
    getBalance: { execute: vi.fn(async () => []) },
    listNotifications: { execute: vi.fn(async () => []) },
  };
}

describe("hono app shell", () => {
  it("GET /health returns the Nest parity payload", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", service: "tfm-api" });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns a Nest-shaped 404 for unknown routes", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      statusCode: 404,
      message: "Cannot GET /api/v1/nope",
      error: "Not Found",
    });
  });
});

describe("HTTP hardening (S4 — GAP-SEC-02)", () => {
  it("sets security headers on every response", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toContain(
      "max-age=",
    );
  });

  it("reflects only allowlisted origins", async () => {
    const app = createApp(makeDeps(), {
      corsOrigins: ["https://app.example.com"],
    });

    const allowed = await app.request("/api/v1/balance", {
      headers: { origin: "https://app.example.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );

    const rejected = await app.request("/api/v1/balance", {
      headers: { origin: "https://evil.example.com" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers CORS preflight for allowlisted origins", async () => {
    const app = createApp(makeDeps(), {
      corsOrigins: ["https://app.example.com"],
    });
    const res = await app.request("/api/v1/transactions", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com",
    );
  });

  it("rejects oversized write bodies with a 413 envelope", async () => {
    const app = createApp(makeDeps(), { bodyLimitBytes: 64 });
    const res = await app.request("/api/v1/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concept: "x".repeat(200) }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("rate limiting on writes (S5 — GAP-SEC-05)", () => {
  it("returns 429 RATE_LIMITED once the configured max is exceeded", async () => {
    const app = createApp(makeDeps(), {
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    const post = () =>
      app.request("/api/v1/transactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.99",
        },
        body: JSON.stringify({}),
      });

    await post();
    await post();
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
  });

  it("keeps reads on their own budget, not the write max", async () => {
    // S2: reads are limited too, but by the (higher) read budget — a
    // write max of 1 must not throttle GETs.
    const app = createApp(makeDeps(), {
      rateLimit: { max: 1, windowMs: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/v1/balance");
      expect(res.status).toBe(200);
    }
  });
});

describe("rate limiting on reads (S2)", () => {
  const IP = { "x-forwarded-for": "203.0.113.42" };
  const get = (app: ReturnType<typeof createApp>) =>
    app.request("/api/v1/balance", { headers: IP });
  const post = (app: ReturnType<typeof createApp>) =>
    app.request("/api/v1/transactions", {
      method: "POST",
      headers: { ...IP, "content-type": "application/json" },
      body: "{}",
    });

  it("returns 429 RATE_LIMITED once the read max is exceeded", async () => {
    const app = createApp(makeDeps(), {
      rateLimitRead: { max: 2, windowMs: 60_000 },
    });
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(200);
    const res = await get(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
  });

  it("keeps the write budget untouched by reads and vice versa", async () => {
    const app = createApp(makeDeps(), {
      rateLimit: { max: 1, windowMs: 60_000 },
      rateLimitRead: { max: 2, windowMs: 60_000 },
    });
    // Exhaust the read bucket…
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
    // …the write budget is untouched: the first POST reaches the
    // route (400 INVALID_BODY proves it passed the limiter), the
    // second trips the write cap.
    expect((await post(app)).status).toBe(400);
    expect((await post(app)).status).toBe(429);
    // A write never consumed the read bucket: another IP can still
    // read — same client stays 429 until the window resets.
    const other = await app.request("/api/v1/balance", {
      headers: { "x-forwarded-for": "198.51.100.7" },
    });
    expect(other.status).toBe(200);
  });
});

describe("error hardening (S7 — NEW-SEC-12 + GAP-SEC-04)", () => {
  it("logs unknown exceptions before the generic 500 envelope", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = makeDeps();
      deps.listNotifications.execute.mockRejectedValue(new Error("db down"));
      const app = createApp(deps);
      const res = await app.request("/api/v1/notifications");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("sanitizes zod details in 400 envelopes", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/v1/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "expense" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      details: Array<Record<string, unknown>>;
    };
    expect(body.code).toBe("INVALID_BODY");
    expect(body.details.length).toBeGreaterThan(0);
    for (const detail of body.details) {
      expect(Object.keys(detail).sort()).toEqual([
        "code",
        "message",
        "path",
      ]);
    }
  });
});
