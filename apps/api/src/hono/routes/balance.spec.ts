import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import { WorkspaceId } from "../../modules/shared-kernel/index.js";
import { registerBalanceRoutes } from "./balance.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const ITEM = {
  currency: "PEN",
  initialBalance: "5200.00",
  income: "4500.00",
  expenses: "565.75",
  net: "3934.25",
  balance: "9134.25",
};

function buildApp(options: { authenticated?: boolean } = {}) {
  const authenticated = options.authenticated ?? true;
  const deps = {
    callerResolver: {
      resolve: vi.fn(async () =>
        authenticated ? { issuer: "test", subject: "user-1" } : null,
      ),
    },
    workspaceContext: {
      resolve: vi.fn(async () => ({
        workspaceId: WS,
        locale: "en",
        timezone: "UTC",
        defaultCurrency: "PEN",
      })),
    },
    getBalance: {
      execute: vi.fn(async () => [ITEM]),
    },
  };
  const app = new Hono<HonoEnv>();
  registerBalanceRoutes(app, deps);
  app.onError(httpErrorHandler());
  return { app, deps };
}

describe("GET /api/v1/balance", () => {
  it("returns the per-currency balance items for the caller workspace", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/balance", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([ITEM]);
    expect(deps.getBalance.execute).toHaveBeenCalledWith(WS);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request("/api/v1/balance");

    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe(
      "UNAUTHENTICATED",
    );
    expect(deps.getBalance.execute).not.toHaveBeenCalled();
  });
});
