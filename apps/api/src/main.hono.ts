import { serve } from "@hono/node-server";

import { buildApp, envFromProcess } from "./hono/composition.js";

/**
 * Entrypoint for the Hono app (spike T4): all wiring lives in
 * `hono/composition.ts#buildApp` so this file and the e2e helpers share the
 * exact same composition. Nest/Prisma remain only in the legacy `main.ts`
 * until the removal phase (T6).
 */

const built = buildApp(envFromProcess());

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: built.app.fetch, port }, (info) => {
  console.log(`[hono-spike] listening on http://localhost:${info.port}`);
});

// ---- Glue Nest gives for free, owned here: graceful shutdown ----
async function shutdown(signal: string): Promise<void> {
  console.log(`[hono-spike] ${signal} received, shutting down`);
  server.close();
  await built.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
