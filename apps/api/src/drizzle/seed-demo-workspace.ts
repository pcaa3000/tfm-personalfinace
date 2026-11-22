import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

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
import type { DrizzleDb, DrizzleSchema } from "./db.js";
import {
  buildDemoPlan,
  DEMO_ACCOUNTS,
  DEMO_CURRENCY,
  DEMO_TIMEZONE,
  type DemoAccountKey,
  type DemoTransaction,
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
 * Reusable core of the "María" demo seed (odd/tasks/demo-maria-seed T2,
 * S4/S6/S7; extracted for demo-maria-login T1, S2). Re-runnable (S4):
 * wipes the demo workspace's ledger and account rows — never the
 * workspace, currencies or categories — and re-seeds them through the
 * real domain use cases (S6), so every INV-* invariant is enforced by
 * construction.
 *
 * Shared by the standalone `pnpm db:seed:demo` script and the dev-only
 * `POST /api/v1/demo/reset` endpoint. The whole reset + re-seed runs in
 * ONE Postgres transaction (advisory: atomicity) — a failure mid-seed
 * rolls the workspace back to its previous state instead of leaving a
 * half-seeded demo.
 *
 * demo-maria-session T2: the bootstrap/account/record helpers below are
 * also the building blocks of `refreshDemoWorkspace` — the rolling
 * 3-month maintenance the shared demo workspace gets on every demo
 * sign-in (`db:seed:demo` full-reseed behavior stays unchanged).
 */

export const DEMO_IDENTITY_KEY = "local|demo-maria";
export const DEMO_WORKSPACE_ID = "ws-demo-maria";
const DEMO_ACTOR = "demo-maria";

/**
 * demo-maria-session T1 (S2): the seed is no longer bound to the single
 * `local|demo-maria` workspace — callers may target any `issuer|subject`
 * identity key through the same code path, so every INV-* invariant
 * still applies verbatim.
 */
export interface DemoWorkspaceTarget {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly kind: string;
}

export interface SeedDemoWorkspaceOptions extends Partial<DemoWorkspaceTarget> {
  readonly now?: Date;
}

const DEFAULT_TARGET: DemoWorkspaceTarget = {
  identityKey: DEMO_IDENTITY_KEY,
  workspaceId: DEMO_WORKSPACE_ID,
  kind: "personal",
};

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

export interface DemoSeedCounts {
  readonly income: number;
  readonly expense: number;
  readonly transfer: number;
}

export interface DemoSeedAccountBalance {
  readonly name: string;
  readonly kind: string;
  /** Major-unit decimal string (e.g. "8000.00"). */
  readonly balance: string;
}

export interface DemoSeedResult {
  readonly identityKey: string;
  readonly workspaceId: string;
  readonly counts: DemoSeedCounts;
  readonly totalTransactions: number;
  readonly accounts: readonly DemoSeedAccountBalance[];
}

type WorkspaceRow = typeof workspaces.$inferSelect;

function minorToDecimal(minor: bigint | number): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const soles = absolute / 100n;
  const cents = absolute % 100n;
  return `${sign}${soles}.${String(cents).padStart(2, "0")}`;
}

export interface DemoWorkspaceBootstrap {
  readonly workspace: WorkspaceRow;
  readonly workspaceId: WorkspaceId;
  /** True when this call inserted the workspace row. */
  readonly created: boolean;
}

/**
 * Workspace bootstrap (S7): finds or creates the target workspace and
 * ensures its PEN currency plus the workspace-owned copies of the global
 * catalog — idempotent, so the refresh routine can run it on every demo
 * sign-in without clobbering an already-provisioned workspace.
 */
export async function bootstrapDemoWorkspace(
  tx: DrizzleDb,
  target: DemoWorkspaceTarget,
): Promise<DemoWorkspaceBootstrap> {
  const [existingWorkspace] = await tx
    .select()
    .from(workspaces)
    .where(eq(workspaces.identityKey, target.identityKey))
    .limit(1);
  const workspace =
    existingWorkspace ??
    (
      await tx
        .insert(workspaces)
        .values({
          id: target.workspaceId,
          identityKey: target.identityKey,
          kind: target.kind,
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

  await tx
    .insert(currencies)
    .values({
      id: randomUUID(),
      workspaceId: workspace.id,
      code: DEMO_CURRENCY,
    })
    .onConflictDoNothing();

  // Workspace-owned copies of the global catalog (T19 pattern in
  // seed.ts): only workspace rows carry workspaceId — the global
  // catalog itself is seeded by `pnpm db:seed`. On conflict the seed
  // row is RESTORED (un-archived, label/nature reset): a demo visitor
  // archiving a seed category must not break later refreshes
  // (R3-001 — the wipe+re-seed would roll back forever otherwise).
  for (const category of GLOBAL_CATEGORIES) {
    await tx
      .insert(categories)
      .values({ id: randomUUID(), ...category, workspaceId: workspace.id })
      .onConflictDoUpdate({
        target: [categories.key, categories.workspaceId],
        set: {
          label: category.label,
          nature: category.nature,
          archivedAt: null,
        },
      });
  }

  return {
    workspace,
    workspaceId: workspaceIdResult.value,
    created: existingWorkspace === undefined,
  };
}

/** Workspace-owned category ids (key + workspaceId lookup). */
export async function demoCategoryIdByKey(
  tx: DrizzleDb,
  workspaceRowId: string,
): Promise<Map<string, string>> {
  const categoryRows = await tx
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, workspaceRowId),
        isNull(categories.archivedAt),
      ),
    );
  return new Map(categoryRows.map((row) => [row.key, row.id]));
}

/**
 * Ensures the four "María" demo accounts exist, matched by name
 * (demo-maria-session T2): a fresh workspace gets all of them created
 * via the real use case; an already-seeded one binds the existing rows
 * to their generator keys without touching them.
 */
export async function ensureDemoAccounts(
  tx: DrizzleDb,
  workspaceId: WorkspaceId,
): Promise<{
  readonly accountIdByKey: Map<DemoAccountKey, string>;
  readonly created: number;
}> {
  const createAccount = new CreateAccountUseCase(
    new DrizzleAccountRepository(tx),
    new DrizzleCurrencyRepository(tx),
    new CryptoIdGenerator(),
  );
  const existing = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.workspaceId, workspaceId.value),
        isNull(accounts.archivedAt),
      ),
    );
  const idByName = new Map(existing.map((row) => [row.name, row.id]));

  const accountIdByKey = new Map<DemoAccountKey, string>();
  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    const found = idByName.get(account.name);
    if (found !== undefined) {
      accountIdByKey.set(account.key, found);
      continue;
    }
    const createdAccount = await createAccount.execute({
      workspaceId,
      name: account.name,
      currency: DEMO_CURRENCY,
      kind: account.kind,
      initialBalance: account.initialBalance,
    });
    if (!createdAccount.ok) {
      throw new Error(
        `CreateAccount failed for ${account.name}: ${createdAccount.error.code} — ${createdAccount.error.message}`,
      );
    }
    accountIdByKey.set(account.key, createdAccount.value.id);
    created += 1;
  }
  return { accountIdByKey, created };
}

/**
 * Persists plan transactions through RecordManualTransactionUseCase —
 * the same code path the HTTP composition root wires (S6) — and tracks
 * the resulting per-account balances in minor units for summaries.
 * Idempotency keys make a re-run of the same plan a no-op.
 */
export async function recordDemoTransactions(
  tx: DrizzleDb,
  args: {
    readonly workspaceId: WorkspaceId;
    readonly transactions: readonly DemoTransaction[];
    readonly accountIdByKey: ReadonlyMap<DemoAccountKey, string>;
    readonly categoryIdByKey: ReadonlyMap<string, string>;
  },
): Promise<{
  readonly counts: DemoSeedCounts;
  readonly balanceByKey: Map<DemoAccountKey, bigint>;
}> {
  const recordTransaction = new RecordManualTransactionUseCase(
    new DrizzleTransactionRepository(tx),
    new DrizzleAccountRepository(tx),
    new DrizzleCategoryValidationAdapter(tx),
    new SystemClock(),
    new CryptoIdGenerator(),
  );

  // Track balances in minor units for the closing summary: initial
  // balance + income − expense, transfers move between accounts.
  const balanceByKey = new Map<DemoAccountKey, bigint>(
    DEMO_ACCOUNTS.map((account) => {
      const [soles = "0", cents = "0"] = account.initialBalance.split(".");
      const minor = BigInt(soles) * 100n + BigInt(cents.padEnd(2, "0"));
      return [account.key, minor];
    }),
  );

  const counts = { income: 0, expense: 0, transfer: 0 };
  for (const transaction of args.transactions) {
    const accountId = args.accountIdByKey.get(transaction.accountKey);
    if (!accountId) {
      throw new Error(`Unknown account key ${transaction.accountKey}`);
    }
    const destinationAccountId =
      transaction.destinationAccountKey !== undefined
        ? (args.accountIdByKey.get(transaction.destinationAccountKey) ?? null)
        : null;
    if (transaction.type === "transfer" && !destinationAccountId) {
      throw new Error(
        `Unknown destination account ${transaction.destinationAccountKey}`,
      );
    }
    const categoryId =
      transaction.categoryKey !== undefined
        ? (args.categoryIdByKey.get(transaction.categoryKey) ?? null)
        : null;
    if (transaction.categoryKey !== undefined && categoryId === null) {
      throw new Error(`Unknown category key ${transaction.categoryKey}`);
    }

    const amount = minorToDecimal(transaction.amountMinor);
    const recorded = await recordTransaction.execute({
      workspaceId: args.workspaceId,
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

  return { counts, balanceByKey };
}

/**
 * The demo workspace reset (S4/S6): wipes the workspace-scoped ledger,
 * accounts, pending outbox events and notifications — in FK-safe order
 * (splits → revisions → transactions → accounts → outbox →
 * notifications). The workspace row, currencies and category copies are
 * deliberately NOT touched. Shared by {@link seedDemoWorkspaceInTransaction}
 * (full re-seed) and `refreshDemoWorkspace` (S6 restore-on-refresh).
 * Returns the number of ledger transactions deleted.
 */
export async function wipeDemoWorkspaceState(
  tx: DrizzleDb,
  workspaceRowId: string,
): Promise<number> {
  const wiped = await tx
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.workspaceId, workspaceRowId));
  const wipedIds = wiped.map((row) => row.id);
  if (wipedIds.length > 0) {
    await tx
      .delete(ledgerTransactionSplits)
      .where(inArray(ledgerTransactionSplits.transactionId, wipedIds));
    await tx
      .delete(ledgerTransactionRevisions)
      .where(
        inArray(ledgerTransactionRevisions.transactionId, wipedIds),
      );
    await tx
      .delete(ledgerTransactions)
      .where(inArray(ledgerTransactions.id, wipedIds));
  }
  await tx.delete(accounts).where(eq(accounts.workspaceId, workspaceRowId));
  await tx
    .delete(outboxEvents)
    .where(eq(outboxEvents.workspaceId, workspaceRowId));
  await tx
    .delete(notifications)
    .where(eq(notifications.workspaceId, workspaceRowId));
  return wipedIds.length;
}

/**
 * Ensures the demo workspace + PEN currency + workspace category copies,
 * wipes the workspace-scoped ledger/accounts and re-seeds them via the
 * composition-root use cases. Runs inside `db.transaction`, so the
 * `db` argument must be the root database handle (not a transaction).
 */
export async function seedDemoWorkspace(
  db: NodePgDatabase<DrizzleSchema>,
  options: SeedDemoWorkspaceOptions | Date = {},
): Promise<DemoSeedResult> {
  // Backwards compatibility: callers used to pass `now` positionally.
  const resolved: SeedDemoWorkspaceOptions =
    options instanceof Date ? { now: options } : options;
  const target: DemoWorkspaceTarget = {
    identityKey: resolved.identityKey ?? DEFAULT_TARGET.identityKey,
    workspaceId: resolved.workspaceId ?? DEFAULT_TARGET.workspaceId,
    kind: resolved.kind ?? DEFAULT_TARGET.kind,
  };
  return db.transaction(async (tx) =>
    seedDemoWorkspaceInTransaction(tx, target, resolved.now ?? new Date()),
  );
}

/**
 * Transaction-bound core of {@link seedDemoWorkspace} — exported so
 * callers can compose the seed with their own locking/cleanup inside
 * ONE transaction.
 */
export async function seedDemoWorkspaceInTransaction(
  tx: DrizzleDb,
  target: DemoWorkspaceTarget,
  now: Date,
): Promise<DemoSeedResult> {
  const { workspace, workspaceId } = await bootstrapDemoWorkspace(tx, target);

  // ── Reset (S4): wipe the demo workspace's ledger + accounts so a
  // re-seed restores the original synthetic dataset. Splits and
  // revisions go first (FK children); the ledger repository also wrote
  // outbox rows for these transactions, so pending events and their
  // notifications are cleaned too — the workspace, currencies and
  // categories are deliberately NOT touched.
  await wipeDemoWorkspaceState(tx, workspace.id);

  const categoryIdByKey = await demoCategoryIdByKey(tx, workspace.id);
  const { accountIdByKey } = await ensureDemoAccounts(tx, workspaceId);

  const plan = buildDemoPlan(now);
  const { counts, balanceByKey } = await recordDemoTransactions(tx, {
    workspaceId,
    transactions: plan.transactions,
    accountIdByKey,
    categoryIdByKey,
  });

  return {
    identityKey: target.identityKey,
    workspaceId: workspace.id,
    counts,
    totalTransactions: plan.transactions.length,
    accounts: DEMO_ACCOUNTS.map((account) => ({
      name: account.name,
      kind: account.kind,
      balance: minorToDecimal(balanceByKey.get(account.key) ?? 0n),
    })),
  };
}
