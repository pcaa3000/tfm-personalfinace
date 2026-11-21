import { createDrizzleDb } from "./db.js";
import { seedDemoWorkspace } from "./seed-demo-workspace.js";

/**
 * Demo seed for the "María" profile — thin CLI wrapper over
 * {@link seedDemoWorkspace} (extracted for demo-maria-login T1 so the
 * dev-only POST /api/v1/demo/reset endpoint reuses the exact same
 * reset + re-seed).
 *
 * Run standalone like seed.ts: `tsx src/drizzle/seed-demo.ts`.
 */

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

async function main(): Promise<void> {
  const result = await seedDemoWorkspace(db);

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`Demo seed "María" completed for ${result.identityKey}`);
  console.log(
    `Transactions: ${result.counts.income} income, ` +
      `${result.counts.expense} expense, ${result.counts.transfer} ` +
      `transfer (${result.totalTransactions} total)`,
  );
  for (const account of result.accounts) {
    console.log(`  ${account.name} (${account.kind}): S/ ${account.balance}`);
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
