import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  accounts,
  categories,
  currencies,
  ledgerTransactionRevisions,
  ledgerTransactions,
  ledgerTransactionSplits,
  notifications,
  outboxEvents,
  workspaces,
} from "./schema.js";
import { createDrizzleDb } from "./db.js";
import {
  buildDemoPlan,
  DEMO_CURRENCY,
  DEMO_TIMEZONE,
  type DemoAccountKey,
} from "./seed-demo-data.js";
import { DrizzleAccountRepository } from "../modules/accounts/infrastructure/drizzle-account.repository.js";
import { CreateAccountUseCase } from "../modules/accounts/application/create-account.use-case.js";
import { DrizzleCurrencyRepository } from "../modules/currencies/infrastructure/drizzle-currency.repository.js";
import { DrizzleCategoryValidationAdapter } from "../modules/categorization/infrastructure/drizzle-category-validation.adapter.js";
import { DrizzleTransactionRepository } from "../modules/ledger/infrastructure/persistence/drizzle-transaction.repository.js";
import { RecordManualTransactionUseCase } from "../modules/ledger/application/record-manual-transaction.use-case.js";
import { CryptoIdGenerator } from "../modules/ledger/infrastructure/crypto-id-generator.adapter.js";
import { SystemClock } from "../modules/ledger/infrastructure/system-clock.adapter.js";
import { WorkspaceId } from "../modules/shared-kernel/index.js";

/**
 * Demo seed for the "María" profile (odd/tasks/demo-maria-seed T2,
 * S4/S6/S7). Re-runnable (S4): it wipes the demo workspace's ledger and
 * account rows — never the workspace, currencies or categories — and
 * re-seeds them through the real domain use cases (S6), so every INV-*
 * invariant is enforced by construction.
 *
 * Run standalone like seed.ts: `tsx src/drizzle/seed-demo.ts`.
 */

const DEMO_IDENTITY_KEY = "local|demo-maria";
const DEMO_WORKSPACE_ID = "ws-demo-maria";
const DEMO_ACTOR = "demo-maria";

// Mirrors GLOBAL_CATEGORIES in seed.ts — kept as a copy because seed.ts
// runs side effects at import time and cannot be imported from here.
const GLOBAL_CATEGORIES = [
  { key: "salary", label: "Sueldo", nature: "income" },
  { key: "other_income", label: "Otros ingresos", nature: "income" },
  { key: "home", label: "Hogar", nature: "essential" },
  { key: "food", label: "Comida", nature: "essential" },
  { key: "transport", label: "Transporte", nature: "essential" },
  { key: "health", label: "Salud", nature: "essential" },
  { key: "services", label: "Servicios y suscripciones", nature: "essential" },
  { key: "education", label: "Educación", nature: "essential" },
  { key: "leisure", label: "Ocio", nature: "discretionary" },
  { key: "restaurants", label: "Restaurantes y cafés", nature: "discretionary" },
  { key: "shopping", label: "Compras", nature: "discretionary" },
  { key: "taxes", label: "Impuestos y obligaciones", nature: "obligation" },
] as const;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

const { db, pool } = createDrizzleDb(databaseUrl);

function minorToDecimal(minor: bigint | number): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const soles = absolute / 100n;
  const cents = absolute % 100n;
  return `${sign}${soles}.${String(cents).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  // ── Workspace bootstrap (S7): dedicated demo workspace, separate
  // from local|dev-user. Same pattern as seed.ts.
  const [existingWorkspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.identityKey, DEMO_IDENTITY_KEY))
    .limit(1);
  const workspace =
    existingWorkspace ??
    (
      await db
        .insert(workspaces)
        .values({
          id: DEMO_WORKSPACE_ID,
          identityKey: DEMO_IDENTITY_KEY,
          kind: "personal",
          timezone: DEMO_TIMEZONE,
          defaultCurrency: DEMO_CURRENCY,
        })
        .returning()
    )[0];
  if (!workspace) {
    throw new Error("workspace insert returned no row");
  }

  const workspaceIdResult = WorkspaceId.create(workspace.id);
  if (!workspaceIdResult.ok) {
    throw workspaceIdResult.error;
  }
  const workspaceId = workspaceIdResult.value;

  await db
    .insert(currencies)
    .values({
      id: randomUUID(),
      workspaceId: workspace.id,
      code: DEMO_CURRENCY,
    })
    .onConflictDoNothing();

  // Workspace-owned copies of the global catalog (T19 pattern in
  // seed.ts): only workspace rows carry workspaceId — the global
  // catalog itself is seeded by `pnpm db:seed`.
  for (const category of GLOBAL_CATEGORIES) {
    await db
      .insert(categories)
      .values({ id: randomUUID(), ...category, workspaceId: workspace.id })
      .onConflictDoNothing();
  }

  // ── Reset (S4): wipe the demo workspace's ledger + accounts so a
  // re-seed restores the original synthetic dataset. Splits and
  // revisions go first (FK children); the ledger repository also wrote
  // outbox rows for these transactions, so pending events and their
  // notifications are cleaned too — the workspace, currencies and
  // categories are deliberately NOT touched.
  const workspaceTransactionIds = db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.workspaceId, workspace.id));
  await db
    .delete(ledgerTransactionSplits)
    .where(inArray(ledgerTransactionSplits.transactionId, workspaceTransactionIds));
  await db
    .delete(ledgerTransactionRevisions)
    .where(
      inArray(ledgerTransactionRevisions.transactionId, workspaceTransactionIds),
    );
  await db
    .delete(ledgerTransactions)
    .where(eq(ledgerTransactions.workspaceId, workspace.id));
  await db
    .delete(accounts)
    .where(eq(accounts.workspaceId, workspace.id));
  await db
    .delete(outboxEvents)
    .where(eq(outboxEvents.workspaceId, workspace.id));
  await db
    .delete(notifications)
    .where(eq(notifications.workspaceId, workspace.id));

  // Workspace-owned category ids (key + workspaceId lookup).
  const categoryRows = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, workspace.id),
        isNull(categories.archivedAt),
      ),
    );
  const categoryIdByKey = new Map(categoryRows.map((row) => [row.key, row.id]));

  // ── Use cases wired like the HTTP composition root (S6). ────────
  const ids = new CryptoIdGenerator();
  const clock = new SystemClock();
  const accountRepository = new DrizzleAccountRepository(db);
  const createAccount = new CreateAccountUseCase(
    accountRepository,
    new DrizzleCurrencyRepository(db),
    ids,
  );
  const recordTransaction = new RecordManualTransactionUseCase(
    new DrizzleTransactionRepository(db),
    accountRepository,
    new DrizzleCategoryValidationAdapter(db),
    clock,
    ids,
  );

  const plan = buildDemoPlan(new Date());

  const accountIdByKey = new Map<DemoAccountKey, string>();
  for (const account of plan.accounts) {
    const created = await createAccount.execute({
      workspaceId,
      name: account.name,
      currency: DEMO_CURRENCY,
      kind: account.kind,
      initialBalance: account.initialBalance,
    });
    if (!created.ok) {
      throw new Error(
        `CreateAccount failed for ${account.name}: ${created.error.code} — ${created.error.message}`,
      );
    }
    accountIdByKey.set(account.key, created.value.id);
  }

  // Track balances in minor units for the closing summary: initial
  // balance + income − expense, transfers move between accounts.
  const balanceByKey = new Map<DemoAccountKey, bigint>(
    plan.accounts.map((account) => {
      const [soles = "0", cents = "0"] = account.initialBalance.split(".");
      const minor = BigInt(soles) * 100n + BigInt(cents.padEnd(2, "0"));
      return [account.key, minor];
    }),
  );

  const counts = { income: 0, expense: 0, transfer: 0 };
  for (const transaction of plan.transactions) {
    const accountId = accountIdByKey.get(transaction.accountKey);
    if (!accountId) {
      throw new Error(`Unknown account key ${transaction.accountKey}`);
    }
    const destinationAccountId =
      transaction.destinationAccountKey !== undefined
        ? (accountIdByKey.get(transaction.destinationAccountKey) ?? null)
        : null;
    if (transaction.type === "transfer" && !destinationAccountId) {
      throw new Error(
        `Unknown destination account ${transaction.destinationAccountKey}`,
      );
    }
    const categoryId =
      transaction.categoryKey !== undefined
        ? (categoryIdByKey.get(transaction.categoryKey) ?? null)
        : null;
    if (transaction.categoryKey !== undefined && categoryId === null) {
      throw new Error(`Unknown category key ${transaction.categoryKey}`);
    }

    const amount = minorToDecimal(transaction.amountMinor);
    const recorded = await recordTransaction.execute({
      workspaceId,
      idempotencyKey: transaction.idempotencyKey,
      type: transaction.type,
      amount,
      currency: DEMO_CURRENCY,
      businessDate: transaction.businessDate,
      timezone: DEMO_TIMEZONE,
      concept: transaction.concept,
      accountId,
      destinationAccountId,
      categoryId,
      origin: "manual",
      actor: DEMO_ACTOR,
    });
    if (!recorded.ok) {
      throw new Error(
        `RecordManualTransaction failed for ${transaction.idempotencyKey} ` +
          `(${transaction.concept} ${amount}): ` +
          `${recorded.error.code} — ${recorded.error.message}`,
      );
    }

    counts[transaction.type] += 1;
    const delta = BigInt(transaction.amountMinor);
    if (transaction.type === "income") {
      balanceByKey.set(
        transaction.accountKey,
        (balanceByKey.get(transaction.accountKey) ?? 0n) + delta,
      );
    } else if (transaction.type === "expense") {
      balanceByKey.set(
        transaction.accountKey,
        (balanceByKey.get(transaction.accountKey) ?? 0n) - delta,
      );
    } else {
      balanceByKey.set(
        transaction.accountKey,
        (balanceByKey.get(transaction.accountKey) ?? 0n) - delta,
      );
      const destination = transaction.destinationAccountKey;
      if (destination) {
        balanceByKey.set(
          destination,
          (balanceByKey.get(destination) ?? 0n) + delta,
        );
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`Demo seed "María" completed for ${DEMO_IDENTITY_KEY}`);
  console.log(
    `Transactions: ${counts.income} income, ${counts.expense} expense, ` +
      `${counts.transfer} transfer (${plan.transactions.length} total)`,
  );
  for (const account of plan.accounts) {
    const balance = balanceByKey.get(account.key) ?? 0n;
    console.log(
      `  ${account.name} (${account.kind}): S/ ${minorToDecimal(balance)}`,
    );
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
