import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres/session";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import pg from "pg";

import * as schema from "./schema.js";

const { Pool } = pg;

export type DrizzleSchema = typeof schema;
export type DrizzleDb =
  | NodePgDatabase<DrizzleSchema>
  | NodePgTransaction<DrizzleSchema, ExtractTablesWithRelations<DrizzleSchema>>;

/** Factory over an existing Postgres pool + the Drizzle schema mirror. */
export function createDrizzleDb(databaseUrl: string): {
  db: NodePgDatabase<DrizzleSchema>;
  pool: pg.Pool;
} {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
