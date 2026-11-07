import { Hono } from "hono";

import { httpErrorHandler } from "./middleware/errors.js";
import type { HonoEnv } from "./middleware/auth.js";
import type { AccountRouteDeps } from "./routes/accounts.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import type { TransactionRouteDeps } from "./routes/transactions.js";
import { registerTransactionRoutes } from "./routes/transactions.js";

export type { HonoEnv } from "./middleware/auth.js";

/** Everything the Hono slice needs: auth ports + the use cases per resource. */
export type HonoDeps = TransactionRouteDeps & AccountRouteDeps;

/**
 * Builds the Hono app for the transactions + accounts HTTP slice. Routes are
 * mounted under the same paths the Nest controllers declare, plus the
 * `/health` parity endpoint. Testable via `app.request()` without a server.
 */
export function createApp(deps: HonoDeps): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "tfm-api",
      timestamp: new Date().toISOString(),
    }),
  );

  registerTransactionRoutes(app, deps);
  registerAccountRoutes(app, deps);

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
