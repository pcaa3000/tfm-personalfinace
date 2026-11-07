import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { httpErrorHandler } from "../middleware/errors.js";
import type { HonoEnv } from "../middleware/auth.js";
import { WorkspaceId } from "../../modules/shared-kernel/index.js";
import { registerNotificationRoutes } from "./notifications.js";

const wsResult = WorkspaceId.create("ws-1");
if (!wsResult.ok) throw new Error("workspace setup failed");
const WS = wsResult.value;

const ITEM = {
  id: "n-1",
  workspaceId: "ws-1",
  kind: "transaction.confirmed",
  title: "Movimiento registrado",
  body: "Sueldo · 4500.00 PEN",
  createdAt: "2026-11-07T10:00:00.000Z",
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
    listNotifications: {
      execute: vi.fn(async () => [ITEM]),
    },
  };
  const app = new Hono<HonoEnv>();
  registerNotificationRoutes(app, deps);
  app.onError(httpErrorHandler());
  return { app, deps };
}

describe("GET /api/v1/notifications", () => {
  it("returns the workspace notifications", async () => {
    const { app, deps } = buildApp();

    const res = await app.request("/api/v1/notifications", {
      headers: { "x-dev-user": "t" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([ITEM]);
    expect(deps.listNotifications.execute).toHaveBeenCalledWith(WS);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { app, deps } = buildApp({ authenticated: false });

    const res = await app.request("/api/v1/notifications");

    expect(res.status).toBe(401);
    expect(deps.listNotifications.execute).not.toHaveBeenCalled();
  });
});
