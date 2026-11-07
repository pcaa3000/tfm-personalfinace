import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

/**
 * drizzle-kit config for the spike. Introspection/migration generation is
 * NOT part of the spike — Prisma migrations remain the source of truth for
 * the physical schema. This file only enables `drizzle-kit` tooling over
 * the Drizzle mirror in src/drizzle/schema.ts.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: fileURLToPath(new URL("./src/drizzle/schema.ts", import.meta.url)),
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
