import { randomUUID } from "node:crypto";

import { createDrizzleDb } from "./db.js";
import { refreshDemoWorkspace } from "./refresh-demo-workspace.js";
import {
  DEMO_IDENTITY_KEY,
  DEMO_WORKSPACE_ID,
} from "./seed-demo-workspace.js";

/**
 * Demo refresh CLI — thin wrapper over {@link refreshDemoWorkspace}
 * (odd/tasks/demo-maria-session T2, S4; S6 restore semantics): wipes
 * the "María" demo workspace's ledger/accounts/outbox/notifications and
 * re-seeds the rolling 3-month window, restoring the original
 * synthetic dataset. Reuses the exact same routine as
 * POST /api/v1/demo/refresh.
 *
 * Defaults to the dev demo workspace `local|demo-maria`; override with
 * DEMO_IDENTITY_KEY (e.g. `<OIDC_ISSUER>|<demo-uid>` for qa) and
 * DEMO_WORKSPACE_ID for the id used when the row must be created.
 *
 * Run standalone like seed-demo.ts: `tsx src/drizzle/seed-demo-refresh.ts`.
 */

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

async function main(): Promise<void> {
  const identityKey = process.env.DEMO_IDENTITY_KEY ?? DEMO_IDENTITY_KEY;
  const result = await refreshDemoWorkspace(db, {
    identityKey,
    // The stable ws-demo-maria id belongs to the dev identity only — a
    // different (e.g. oidc) identity gets a fresh id unless overridden.
    workspaceId:
      process.env.DEMO_WORKSPACE_ID ??
      (identityKey === DEMO_IDENTITY_KEY ? DEMO_WORKSPACE_ID : randomUUID()),
  });

  console.log(`Demo refresh "María" completed for ${result.identityKey}`);
  console.log(
    `Workspace ${result.workspaceId}` +
      `${result.workspaceCreated ? " (created)" : ""}` +
      ` — accounts created: ${result.accountsCreated}`,
  );
  console.log(
    `Wiped transactions (seed state restored): ${result.purgedTransactions}`,
  );
  console.log(
    `Generated months: ${
      result.generatedMonths.length > 0
        ? result.generatedMonths.join(", ")
        : "none"
    }`,
  );
  console.log(`Inserted transactions: ${result.insertedTransactions}`);
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
