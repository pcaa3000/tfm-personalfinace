import { and, inArray, isNull } from "drizzle-orm";

import { createDrizzleDb } from "./db.js";
import {
  categories,
  ledgerTransactions,
  ledgerTransactionSplits,
} from "./schema.js";
import { isTestSeededGlobalCategoryKey } from "../modules/categorization/infrastructure/drizzle-category-validation.adapter.js";

/**
 * Leaked test-category cleanup CLI (demo-seed-six-months T3, S3 —
 * L5: "Comida E2E", "Semilla uno/dos", `spec_global_key` visible in
 * the transaction form): deletes GLOBAL (`workspaceId` NULL) category
 * rows whose key marks a spec/e2e fixture. It reuses
 * {@link isTestSeededGlobalCategoryKey} — the exact predicate
 * `listForWorkspace` applies — so the sweep removes what the read
 * path hides (`e2e-*`, `spec_*`, `spec-*`), including archived rows.
 *
 * Safety: a row still referenced by `ledger_transactions.categoryId`
 * (no FK, but a logical reference) or `ledger_transaction_splits.
 * categoryId` (FK with ON DELETE RESTRICT — the only schema FK into
 * this table) is skipped and reported, never deleted. Workspace-owned
 * copies are user data and are never touched. There is no
 * category-rules table in the schema.
 *
 * Run standalone like demo-cleanup.ts:
 * `tsx src/drizzle/cleanup-test-data.ts` (wired as
 * `pnpm db:cleanup:test-data`).
 */

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

async function main(): Promise<void> {
  const globals = await db
    .select({ id: categories.id, key: categories.key })
    .from(categories)
    .where(isNull(categories.workspaceId));
  const candidates = globals.filter((row) =>
    isTestSeededGlobalCategoryKey(row.key),
  );

  if (candidates.length === 0) {
    console.log("Test data cleanup: no leaked global test categories found");
    return;
  }

  const ids = candidates.map((row) => row.id);
  const txRefs = await db
    .select({ categoryId: ledgerTransactions.categoryId })
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.categoryId, ids));
  const splitRefs = await db
    .select({ categoryId: ledgerTransactionSplits.categoryId })
    .from(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.categoryId, ids));
  const referenced = new Set(
    [...txRefs, ...splitRefs]
      .map((row) => row.categoryId)
      .filter((id): id is string => id !== null),
  );

  const deletable = candidates.filter((row) => !referenced.has(row.id));
  const skipped = candidates.filter((row) => referenced.has(row.id));

  if (deletable.length > 0) {
    await db
      .delete(categories)
      .where(
        and(
          isNull(categories.workspaceId),
          inArray(categories.id, deletable.map((row) => row.id)),
        ),
      );
  }

  console.log(
    `Test data cleanup: deleted ${deletable.length} leaked global ` +
      `categories, skipped ${skipped.length} still referenced`,
  );
  for (const row of deletable) {
    console.log(`  - deleted ${row.key} (${row.id})`);
  }
  for (const row of skipped) {
    console.log(`  ! skipped ${row.key} (${row.id}) — still referenced`);
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
