import { serve } from "@hono/node-server";
import { PrismaClient } from "@prisma/client";

import { createApp } from "./hono/app.js";
import { createDrizzleDb } from "./drizzle/db.js";
import { DeterministicWorkspaceAdapter } from "./modules/identity-workspace/infrastructure/deterministic-workspace.adapter.js";
import { DevHeaderCallerResolver } from "./modules/identity-workspace/infrastructure/http/dev-header-caller.resolver.js";
import { JwtCallerResolver } from "./modules/identity-workspace/infrastructure/http/jwt-caller.resolver.js";
import { DrizzleAccountRepository } from "./modules/accounts/infrastructure/drizzle-account.repository.js";
import { CreateAccountUseCase } from "./modules/accounts/application/create-account.use-case.js";
import { ListAccountsUseCase } from "./modules/accounts/application/list-accounts.use-case.js";
import { ReviseAccountUseCase } from "./modules/accounts/application/revise-account.use-case.js";
import { ArchiveAccountUseCase } from "./modules/accounts/application/archive-account.use-case.js";
import { PrismaCategoryValidationAdapter } from "./modules/categorization/infrastructure/prisma-category-validation.adapter.js";
import { PrismaCategoryRepository } from "./modules/categorization/infrastructure/prisma-category.repository.js";
import { PrismaCurrencyRepository } from "./modules/currencies/infrastructure/prisma-currency.repository.js";
import { CryptoIdGenerator } from "./modules/ledger/infrastructure/crypto-id-generator.adapter.js";
import { DrizzleTransactionRepository } from "./modules/ledger/infrastructure/persistence/drizzle-transaction.repository.js";
import { SystemClock } from "./modules/ledger/infrastructure/system-clock.adapter.js";
import { RecordManualTransactionUseCase } from "./modules/ledger/application/record-manual-transaction.use-case.js";
import { ListTransactionsUseCase } from "./modules/ledger/application/list-transactions.use-case.js";
import { ReviseTransactionUseCase } from "./modules/ledger/application/revise-transaction.use-case.js";
import { VoidTransactionUseCase } from "./modules/ledger/application/void-transaction.use-case.js";
import { ListTransactionRevisionsUseCase } from "./modules/ledger/application/list-transaction-revisions.use-case.js";

/**
 * Spike composition root (T4): plain function wiring, no DI container.
 *
 * Transactions + accounts run on Drizzle; workspace/categorization/currencies
 * stay on Prisma — out of spike scope. The same use-case classes and ports
 * serve both stacks, which is the point: the composition root is where the
 * choice lives, and it is a few dozen lines, not a module DSL.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`AUTH_MODE=oidc requires ${name} to be set`);
  }
  return value;
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://tfm:tfm-local-dev@localhost:5432/personal_finance";

// ---- Drizzle slice (spike scope) ----
const { db, pool } = createDrizzleDb(databaseUrl);
const transactions = new DrizzleTransactionRepository(db);
const accounts = new DrizzleAccountRepository(db);

// ---- Prisma slice (out of spike scope; pending modules) ----
const prisma = new PrismaClient();
const currencies = new PrismaCurrencyRepository(prisma);
const categories = new PrismaCategoryRepository(prisma);
const categoryValidation = new PrismaCategoryValidationAdapter(prisma);
const workspaceContext = new DeterministicWorkspaceAdapter(
  prisma,
  currencies,
  categories,
);

const callerResolver =
  process.env.AUTH_MODE === "oidc"
    ? new JwtCallerResolver({
        issuer: requiredEnv("OIDC_ISSUER"),
        audience: requiredEnv("OIDC_AUDIENCE"),
        jwksUri: requiredEnv("OIDC_JWKS_URI"),
      })
    : new DevHeaderCallerResolver();

const clock = new SystemClock();
const ids = new CryptoIdGenerator();

const app = createApp({
  callerResolver,
  workspaceContext,
  recordManual: new RecordManualTransactionUseCase(
    transactions,
    accounts,
    categoryValidation,
    clock,
    ids,
  ),
  listTransactions: new ListTransactionsUseCase(transactions),
  reviseTransaction: new ReviseTransactionUseCase(
    transactions,
    accounts,
    categoryValidation,
    clock,
  ),
  voidTransaction: new VoidTransactionUseCase(transactions, clock),
  listRevisions: new ListTransactionRevisionsUseCase(transactions),
  createAccount: new CreateAccountUseCase(accounts, currencies, ids),
  listAccounts: new ListAccountsUseCase(accounts),
  reviseAccount: new ReviseAccountUseCase(accounts),
  archiveAccount: new ArchiveAccountUseCase(accounts),
});

const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[hono-spike] listening on http://localhost:${info.port}`);
});

// ---- Glue Nest gives for free, owned here: graceful shutdown ----
async function shutdown(signal: string): Promise<void> {
  console.log(`[hono-spike] ${signal} received, shutting down`);
  server.close();
  await pool.end();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
