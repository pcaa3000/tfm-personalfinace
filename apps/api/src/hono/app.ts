import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { httpErrorHandler } from "./middleware/errors.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import type { HonoEnv } from "./middleware/auth.js";
import type { AccountRouteDeps } from "./routes/accounts.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import type { BalanceRouteDeps } from "./routes/balance.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import type { CategoryRouteDeps } from "./routes/categories.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import type { CurrencyRouteDeps } from "./routes/currencies.js";
import { registerCurrencyRoutes } from "./routes/currencies.js";
import type { NotificationRouteDeps } from "./routes/notifications.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import type { TransactionRouteDeps } from "./routes/transactions.js";
import { registerTransactionRoutes } from "./routes/transactions.js";
import type { WorkspaceRouteDeps } from "./routes/workspace.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";

export type { HonoEnv } from "./middleware/auth.js";

/** Everything the Hono slice needs: auth ports + the use cases per resource. */
export type HonoDeps = TransactionRouteDeps &
  AccountRouteDeps &
  BalanceRouteDeps &
  CategoryRouteDeps &
  CurrencyRouteDeps &
  WorkspaceRouteDeps &
  NotificationRouteDeps;

/** HTTP hardening knobs (S4/S5) — resolved from env in the composition root. */
export interface HttpSecurityConfig {
  readonly corsOrigins: readonly string[];
  readonly bodyLimitBytes: number;
  readonly rateLimit: {
    readonly max: number;
    readonly windowMs: number;
  };
}

/** Dev defaults: the Vite origin, 1 MiB bodies, 60 writes/minute per IP. */
export const DEFAULT_HTTP_SECURITY: HttpSecurityConfig = {
  corsOrigins: ["http://localhost:5173"],
  bodyLimitBytes: 1024 * 1024,
  rateLimit: { max: 60, windowMs: 60_000 },
};

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Builds the Hono app for the migrated HTTP slice. Routes are mounted
 * under the same paths the Nest controllers declare, plus the `/health`
 * parity endpoint. Testable via `app.request()` without a server.
 *
 * GAP-SEC-02 (S4): `secureHeaders` on every response, a CORS origin
 * allowlist (the web client authenticates via Authorization header, so no
 * credentials), and a deliberate body cap on write methods.
 * GAP-SEC-05 (S5): per-IP rate limiting on /api/v1 writes.
 */
export function createApp(
  deps: HonoDeps,
  security: Partial<HttpSecurityConfig> = {},
): Hono<HonoEnv> {
  const config: HttpSecurityConfig = { ...DEFAULT_HTTP_SECURITY, ...security };
  const app = new Hono<HonoEnv>();

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: [...config.corsOrigins],
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/api/*", async (c, next) => {
    if (!WRITE_METHODS.has(c.req.method)) {
      return next();
    }
    return bodyLimit({
      maxSize: config.bodyLimitBytes,
      onError: (ctx) =>
        ctx.json(
          { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
          413,
        ),
    })(c, next);
  });
  if (config.rateLimit.max > 0) {
    app.use("/api/v1/*", rateLimitMiddleware(config.rateLimit));
  }

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "tfm-api",
      timestamp: new Date().toISOString(),
    }),
  );

  registerTransactionRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerBalanceRoutes(app, deps);
  registerCategoryRoutes(app, deps);
  registerCurrencyRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
  registerNotificationRoutes(app, deps);

  app.notFound((c) =>
    c.json(
      {
        statusCode: 404,
        message: `Cannot ${c.req.method} ${c.req.path}`,
        error: "Not Found",
      },
      404,
    ),
  );

  app.onError(httpErrorHandler());

  return app;
}
