import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

/**
 * drizzle-kit config — src/drizzle/schema.ts is the source of truth for the
 * physical schema; `db:generate` emits migrations under ./drizzle.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: fileURLToPath(new URL("./src/drizzle/schema.ts", import.meta.url)),
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
