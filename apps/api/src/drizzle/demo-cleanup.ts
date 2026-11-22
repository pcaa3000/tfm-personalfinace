import { createDrizzleDb } from "./db.js";
import {
  cleanupDemoWorkspaces,
  demoOrphanCutoff,
} from "./demo-session-workspaces.js";

/**
 * Demo orphan cleanup CLI — thin wrapper over
 * {@link cleanupDemoWorkspaces} (odd/tasks/demo-maria-session T7,
 * L10): deletes every ephemeral per-session demo workspace of
 * kind='demo' whose `createdAt` is older than now − 24h, with all its
 * data, whatever its subject. The same sweep runs inside the async
 * session seed job and inside DELETE /api/v1/demo/session.
 *
 * Run standalone like seed-demo.ts: `tsx src/drizzle/demo-cleanup.ts`
 * (wired as `pnpm db:demo:cleanup`).
 */

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

async function main(): Promise<void> {
  const olderThan = demoOrphanCutoff();
  const result = await cleanupDemoWorkspaces(db, { olderThan });

  console.log(
    `Demo workspace cleanup: removed ${result.deletedWorkspaceIds.length} ` +
      `orphan workspaces (created before ${olderThan.toISOString()})`,
  );
  for (const id of result.deletedWorkspaceIds) {
    console.log(`  - ${id}`);
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
