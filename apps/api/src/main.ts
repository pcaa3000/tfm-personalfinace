import { serve } from "@hono/node-server";

import { buildApp, envFromProcess } from "./hono/composition.js";

/**
 * API entrypoint: all wiring lives in `hono/composition.ts#buildApp` so this
 * file and the e2e helpers share the exact same composition.
 */

const built = buildApp(envFromProcess());

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: built.app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

// ---- Glue Nest gives for free, owned here: graceful shutdown ----
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] ${signal} received, shutting down`);
  server.close();
  await built.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
